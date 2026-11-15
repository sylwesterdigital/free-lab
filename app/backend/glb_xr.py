"""Bounded, texture-aware GLB -> XR triangle preview.

No external URI fetching, no provider submissions, and no optional dependencies
beyond Pillow (already required by the server). Node transforms, materials and
embedded base-colour images are retained. Dense meshes are vertex clustered so
faces form a continuous coarse surface rather than sparse random triangles.
"""
from __future__ import annotations
import base64, io, json, math, struct
from collections import defaultdict
from PIL import Image, ImageOps, UnidentifiedImageError
from .glb_preview import MAX_FILE

MAX_TRIANGLES = 12000
MAX_TEXTURES = 4
MAX_TEXTURE_EDGE = 640
MAX_INPUT_FACES = 600_000
MAX_NODES = 256

I = (1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.)


def matmul(a, b):
    return tuple(sum(a[k*4+r]*b[c*4+k] for k in range(4)) for c in range(4) for r in range(4))


def local_transform(node):
    if 'matrix' in node:
        m = node['matrix']
        if not isinstance(m, list) or len(m) != 16 or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in m):
            raise ValueError('Invalid GLB node matrix')
        return tuple(m)
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    t = node.get('translation', [0, 0, 0])
    s = node.get('scale', [1, 1, 1])
    if len(t) != 3 or len(s) != 3 or not all(math.isfinite(float(i)) for i in (*t, *s, x, y, z, w)):
        raise ValueError('Invalid GLB transform')
    m = (1-2*(y*y+z*z), 2*(x*y+z*w), 2*(x*z-y*w), 0,
         2*(x*y-z*w), 1-2*(x*x+z*z), 2*(y*z+x*w), 0,
         2*(x*z+y*w), 2*(y*z-x*w), 1-2*(x*x+y*y), 0,
         0, 0, 0, 1)
    return tuple(m[c*4+r]*s[c] if c < 3 else float(t[r]) if r < 3 else 1.
                 for c in range(4) for r in range(4))


def transform(m, p):
    return (m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],
            m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],
            m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14])


def chunks(data):
    if not isinstance(data, bytes) or len(data) < 20 or len(data) > MAX_FILE:
        raise ValueError('Invalid GLB size for Quest preview')
    magic, version, length = struct.unpack_from('<4sII', data)
    if magic != b'glTF' or version != 2 or length != len(data):
        raise ValueError('Invalid GLB v2 file')
    i = 12
    doc = binary = None
    while i+8 <= len(data):
        n, typ = struct.unpack_from('<I4s', data, i)
        i += 8
        if n > MAX_FILE or i+n > len(data):raise ValueError('Invalid GLB chunk')
        value = data[i:i+n]
        i += n
        if typ == b'JSON':doc = json.loads(value)
        elif typ == b'BIN\0':binary = value
    if i != len(data) or not isinstance(doc, dict) or not isinstance(binary, bytes):
        raise ValueError('Missing GLB JSON or binary chunk')
    if not isinstance(doc.get('meshes'), list):raise ValueError('GLB contains no meshes')
    return doc, binary


def accessor_reader(doc, binary):
    views = doc.get('bufferViews', [])
    accessors = doc.get('accessors', [])
    formats = {5126:('f', 4), 5125:('I', 4), 5123:('H', 2), 5121:('B', 1), 5122:('h', 2), 5120:('b', 1)}
    dims = {'SCALAR':1, 'VEC2':2, 'VEC3':3}
    def read(index, dimensions, allowed):
        try:
            a = accessors[index]
            if a.get('sparse') or not isinstance(a.get('bufferView'), int):raise ValueError('Sparse GLB not supported')
            view = views[a['bufferView']]
            typ = a['componentType']
            fmt, width = formats[typ]
            if typ not in allowed or a['type'] not in dims or dims[a['type']] != dimensions:raise ValueError('GLB attribute mismatch')
            if view.get('buffer', 0) != 0:raise ValueError('External GLB buffers are not supported')
            count = a['count']
            stride = view.get('byteStride', width*dimensions)
            if not isinstance(count, int) or count < 0 or count > 1_000_000 or stride < width*dimensions or stride > 256:
                raise ValueError('Excessive GLB accessor')
            start = view.get('byteOffset', 0)+a.get('byteOffset', 0)
            end = view.get('byteOffset', 0)+view['byteLength']
            if start < 0 or end > len(binary) or (count and start+(count-1)*stride+width*dimensions > end):
                raise ValueError('GLB accessor exceeds binary buffer')
            values = [struct.unpack_from('<'+fmt*dimensions, binary, start+i*stride) for i in range(count)]
            if a.get('normalized') and typ != 5126:
                divisor = {5121:255.,5123:65535.,5120:127.,5122:32767.}.get(typ, 1.)
                return [tuple(max(-1., float(v)/divisor) for v in row) for row in values]
            return values
        except (KeyError, IndexError, TypeError, struct.error) as e:
            raise ValueError('Malformed GLB geometry accessor') from e
    return read


def model_nodes(doc):
    nodes = doc.get('nodes') or []
    if not nodes:
        return [(n, I) for n in range(min(10, len(doc['meshes'])))]
    scenes = doc.get('scenes') or []
    if scenes:
        roots = scenes[min(max(int(doc.get('scene', 0)),0), len(scenes)-1)].get('nodes', [])
    else:
        child_ids = {kid for node in nodes for kid in node.get('children', [])}
        roots = [i for i in range(len(nodes)) if i not in child_ids]
    result = []
    def walk(index, parent, seen):
        if index in seen or len(seen) >= MAX_NODES or index < 0 or index >= len(nodes):
            raise ValueError('GLB node hierarchy invalid or too large')
        node = nodes[index]
        m = matmul(parent, local_transform(node))
        if isinstance(node.get('mesh'), int):result.append((node['mesh'], m))
        for kid in node.get('children', []):walk(kid, m, seen | {index})
    for i in roots[:MAX_NODES]:walk(i, I, set())
    return result[:MAX_NODES]


def triangle_cluster(triangles, span, budget):
    """Replace many dense triangles with joined voxel-cell triangles, not sparse fragments."""
    if len(triangles) <= budget:return triangles, False
    for resolution in (85, 65, 48, 36, 28, 20, 14, 10, 6):
        cell = max(span / resolution, 1e-7)
        representatives = {}
        result = []
        used = set()
        for tri in triangles:
            keys = [tuple(math.floor(v[0][i]/cell) for i in range(3)) for v in tri]
            if len(set(keys)) < 3:continue
            # Geometric duplicates vanish, preserving adjacent surface continuity.
            key = tuple(sorted(keys))
            if key in used:continue
            used.add(key)
            for k, v in zip(keys, tri):representatives.setdefault(k, v)
            result.append((keys, tri))
        if len(result) <= budget:
            return [tuple(representatives[k] for k in keys) for keys, _ in result], True
    # If the model is an enormous set of disconnected parts there may be no safe
    # contiguous low-poly mesh. Report it instead of drawing a starfield.
    raise ValueError('3D mesh too complex for a coherent Quest preview; use the full textured model in Collection')


def image_data(doc, binary, image_index, cache, texture_edge=640):
    if image_index in cache:return cache[image_index]
    if len(cache) >= MAX_TEXTURES:return None
    try:
        image = doc.get('images', [])[image_index]
        if 'bufferView' in image:
            view = doc['bufferViews'][image['bufferView']]
            start = view.get('byteOffset',0)
            raw = binary[start:start+view['byteLength']]
            if start < 0 or len(raw) != view['byteLength']:return None
        elif image.get('uri', '').startswith('data:image/'):
            raw = base64.b64decode(image['uri'].split(',', 1)[1],validate=True)
        else:return None  # Never fetch external images or URIs.
        if len(raw)>12_000_000:return None
        Image.MAX_IMAGE_PIXELS = 6_000_000
        with Image.open(io.BytesIO(raw)) as source:
            source.verify()
        with Image.open(io.BytesIO(raw)) as source:
            if source.width*source.height>6_000_000:return None
            pic = ImageOps.exif_transpose(source).convert('RGB')
            pic.thumbnail((texture_edge, texture_edge), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            pic.save(out, format='JPEG', quality=76, optimize=True)
        value = 'data:image/jpeg;base64,'+base64.b64encode(out.getvalue()).decode('ascii')
        cache[image_index] = value
        return value
    except (IndexError, KeyError, TypeError, ValueError, UnidentifiedImageError, OSError):
        return None


def decode_visual(data, texture_edge=640):
    if texture_edge not in (512, 640, 1024, 2048):raise ValueError("Unsupported XR texture size")
    doc, binary = chunks(data)
    read = accessor_reader(doc, binary)
    materials = doc.get('materials', [])
    textures = doc.get('textures', [])
    collected = defaultdict(list)
    total = 0
    coords_bounds = [[float('inf')]*3, [-float('inf')]*3]
    skipped = 0
    for mesh_index, matrix in model_nodes(doc):
        if mesh_index < 0 or mesh_index >= len(doc['meshes']):continue
        mesh = doc['meshes'][mesh_index]
        for prim in mesh.get('primitives', [])[:20]:
            if prim.get('mode',4) != 4 or 'POSITION' not in prim.get('attributes',{}):continue
            if prim.get('extensions'):skipped += 1;continue
            attrib = prim['attributes']
            positions = read(attrib['POSITION'],3,{5126})
            if len(positions) < 3:continue
            uv = read(attrib['TEXCOORD_0'],2,{5126,5121,5123}) if 'TEXCOORD_0' in attrib else None
            if uv is not None and len(uv)!=len(positions):uv=None
            positions = [transform(matrix,p) for p in positions]
            if any(not all(math.isfinite(x) and abs(x)<1e7 for x in p) for p in positions):
                raise ValueError('GLB includes invalid or unbounded coordinates')
            for p in positions:
                for j in range(3):
                    coords_bounds[0][j] = min(coords_bounds[0][j],p[j])
                    coords_bounds[1][j] = max(coords_bounds[1][j],p[j])
            if prim.get('indices') is not None:
                indices = [x[0] for x in read(prim['indices'],1,{5121,5123,5125})]
            else:indices = list(range(len(positions)))
            if total + len(indices)//3 > MAX_INPUT_FACES:raise ValueError('GLB exceeds safe XR geometry budget')
            material_idx = prim.get('material',-1)
            if not isinstance(material_idx, int) or not (0<=material_idx<len(materials)):
                material_idx = -1
            for i in range(0,len(indices)-2,3):
                indices_tri = indices[i:i+3]
                if any(k>=len(positions) or k<0 for k in indices_tri):continue
                tri = tuple((positions[k], (float(uv[k][0]),float(uv[k][1])) if uv else (0.,0.)) for k in indices_tri)
                if any(not all(math.isfinite(x) for x in v[1]) for v in tri):continue
                collected[material_idx].append(tri)
                total += 1
    if not total:raise ValueError('No supported uncompressed GLB triangles for XR')
    mid=[(a+b)/2 for a,b in zip(*coords_bounds)]
    span=max(b-a for a,b in zip(*coords_bounds)) or 1
    parts=[];cache={};remaining=MAX_TRIANGLES
    # Largest material surface first. Reserve a minimum for other material groups.
    for k, tris in sorted(collected.items(), key=lambda kv:-len(kv[1]))[:12]:
        left=max(1,len(collected)-len(parts)-1)
        budget=min(len(tris),max(200,round(MAX_TRIANGLES*len(tris)/total)),remaining-(left*100))
        if budget<1:continue
        surface, simplified=triangle_cluster(tris,span,budget)
        remaining-=len(surface)
        mat=materials[k] if k>=0 else {}
        pbr=mat.get('pbrMetallicRoughness') or {}
        factor=pbr.get('baseColorFactor',[1.,1.,1.,1.])
        if len(factor)!=4 or not all(math.isfinite(float(v)) for v in factor):factor=[1.,1.,1.,1.]
        color=[max(0.,min(1.,float(v))) for v in factor]
        tex=None
        if pbr.get('baseColorTexture'):
            info=pbr['baseColorTexture'];n=info.get('index',-1)
            if type(n) is int and 0<=n<len(textures):
                source=textures[n].get('source')
                if type(source) is int:tex=image_data(doc,binary,source,cache,texture_edge)
        positions_out=[];uvs_out=[]
        for tri in surface:
            for p, u in tri:
                positions_out.extend(round((p[j]-mid[j])/span,5) for j in range(3))
                uvs_out.extend((round(u[0],5),round(u[1],5)))
        parts.append({'positions':positions_out,'uvs':uvs_out,'color':color,'texture':tex,
                      'triangles':len(surface),'simplified':simplified})
    if not parts:raise ValueError('No coherent GLB surface available for XR')
    return {'parts':parts,'triangles':sum(p['triangles'] for p in parts),'texture_omitted':not any(p['texture'] for p in parts),
            'simplified':any(p['simplified'] for p in parts),'normalized':True,
            'note':'Bounded textured XR preview. Full original GLB is available in Collection.'}
