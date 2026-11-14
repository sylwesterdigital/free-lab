"""Strictly bounded GLB preview decoder: positions + triangle indices only.

The full mesh is never forwarded to Quest. This strips texture data for a small,
read-only XR geometry preview while the original GLB link remains downloadable.
"""
import json,math,struct

MAX_FILE = 32_000_000
MAX_TRIANGLES = 3600

def decode(data):
    if not isinstance(data,bytes) or len(data)<20 or len(data)>MAX_FILE:
        raise ValueError('GLB preview exceeds 32 MB: download the original from Collection')
    magic,version,total=struct.unpack_from('<4sII',data)
    if magic!=b'glTF' or version!=2 or total!=len(data):raise ValueError('Invalid GLB v2 file')
    i=12;obj=None;binbuf=None
    while i+8<=len(data):
        length,typ=struct.unpack_from('<I4s',data,i);i+=8
        if length>MAX_FILE or i+length>len(data):raise ValueError('Malformed GLB chunk')
        chunk=data[i:i+length];i+=length
        if typ==b'JSON':obj=json.loads(chunk)
        elif typ==b'BIN\x00':binbuf=chunk
    if i!=len(data) or not isinstance(obj,dict) or not isinstance(binbuf,bytes):
        raise ValueError('Missing GLB JSON/geometry')
    if not obj.get('meshes'):raise ValueError('No meshes in GLB')
    views=obj.get('bufferViews',[]);accessors=obj.get('accessors',[])
    def acc(index,components,allowed):
        a=accessors[index];bv=views[a['bufferView']]
        if a.get('sparse') or a.get('normalized') or a.get('bufferView') is None:
            raise ValueError('Unsupported compressed or sparse geometry')
        if a.get('type') not in ({'VEC3'} if components==3 else {'SCALAR'}):
            raise ValueError('Unexpected GLB attribute shape')
        comp=a['componentType'];fmt,sz={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)}[comp]
        if comp not in allowed:raise ValueError('Unsupported GLB attribute component')
        count=a['count'];stride=bv.get('byteStride',sz*components)
        if count>2_000_000 or stride<sz*components or stride>256:raise ValueError('Excessive GLB accessor')
        off=bv.get('byteOffset',0)+a.get('byteOffset',0)
        end=bv.get('byteOffset',0)+bv['byteLength']
        if count and (off+(count-1)*stride+sz*components>end or end>len(binbuf)):
            raise ValueError('GLB accessor out of bounds')
        return [struct.unpack_from('<'+fmt*components,binbuf,off+k*stride) for k in range(count)]
    positions=[];triangles=[]
    for mesh in obj['meshes'][:10]:
        for prim in mesh.get('primitives',[])[:5]:
            if prim.get('mode',4)!=4 or 'POSITION' not in prim.get('attributes',{}):continue
            if 'extensions' in prim:continue
            p=acc(prim['attributes']['POSITION'],3,{5126})
            if prim.get('indices') is not None:
                ix=[x[0] for x in acc(prim['indices'],1,{5121,5123,5125})]
            else:ix=list(range(len(p)))
            base=len(positions);positions.extend(p)
            triangles.extend([(base+ix[k],base+ix[k+1],base+ix[k+2]) for k in range(0,len(ix)-2,3)
                if ix[k]<len(p) and ix[k+1]<len(p) and ix[k+2]<len(p)])
            if len(triangles)>=MAX_TRIANGLES*6:break
    if not triangles:raise ValueError('No uncompressed triangles suitable for preview')
    stride=max(1,math.ceil(len(triangles)/MAX_TRIANGLES));selected=triangles[::stride][:MAX_TRIANGLES]
    used={idx for tri in selected for idx in tri}
    coords=[positions[k] for k in used]
    if any(not all(math.isfinite(n) for n in p) for p in coords):raise ValueError('Nonfinite mesh')
    minv=[min(p[j] for p in coords) for j in range(3)]
    maxv=[max(p[j] for p in coords) for j in range(3)]
    mid=[(a+b)/2 for a,b in zip(minv,maxv)];span=max(maxv[j]-minv[j] for j in range(3)) or 1
    vertices=[]
    for tri in selected:
        for k in tri:
            p=positions[k]
            vertices.extend([round((p[j]-mid[j])/span,5) for j in range(3)])
    return {'positions':vertices,'triangles':len(selected),'simplified':stride>1,
            'texture_omitted':True,'note':'Bounded geometry preview. Original textured GLB remains available in Library.'}
