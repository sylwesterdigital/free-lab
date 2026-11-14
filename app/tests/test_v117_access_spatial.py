"""v0.10.17 regression checks: retained accounts, opt-in shared frames, XR depth and release notes."""
import sqlite3
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).parents[1]
BACKEND = APP/'backend'
ASSETS = APP/'frontend/assets'

class AccountAndSpatial117(unittest.TestCase):
    def test_migration_retains_existing_user(self):
        import sys
        sys.path.insert(0,str(APP))
        from backend import db
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'users.sqlite3'
            with sqlite3.connect(path) as con:
                con.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL)')
                con.execute("INSERT INTO users(id,username,display_name,password_hash,role) VALUES(7,'olduser','Old User','dummy','member')")
            db.init(path)
            with db.connect(path) as con:
                u=db.user_from_id(con,7)
                self.assertEqual(u['username'],'olduser')
                self.assertEqual(u['auth_revision'],0)
                self.assertEqual(u['blocked_until'],0)
                self.assertTrue(con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='room_presence'").fetchone())

    def test_admin_controls_require_auth_and_invalidate_sessions(self):
        s=(BACKEND/'app.py').read_text()
        self.assertIn("@app.get('/api/admin/profiles')\n@require_admin",s)
        self.assertIn("@app.put('/api/admin/profiles/<int:uid>/password')\n@require_admin",s)
        self.assertIn("@app.put('/api/admin/profiles/<int:uid>/block')\n@require_admin",s)
        self.assertIn("@app.delete('/api/admin/profiles/<int:uid>')\n@require_admin",s)
        self.assertIn('auth_revision=auth_revision+1',s)
        self.assertIn("session.get('revision',0)!=g.user['auth_revision']",s)
        self.assertIn('Account temporarily blocked',s)

    def test_release_notes_history_and_avatar_accessible(self):
        html=(APP/'frontend/index.html').read_text()
        js=(ASSETS/'app.js').read_text()
        self.assertIn('id="logHistory"',html)
        self.assertIn('class="log-scroll"',html)
        self.assertIn('id="profileAvatarInput"',html)
        self.assertIn('class="profile-avatar-round"',html)
        self.assertNotIn('capture="user" class="visually-hidden"',html)
        self.assertIn('for(const old of log.history||[])',js)
        self.assertIn("api('/admin/profiles')",js)

    def test_xr_depth_entry_and_head_relative_control(self):
        xr=(ASSETS/'xr.js').read_text()
        app=(ASSETS/'app.js').read_text()
        self.assertIn("f?.includes?.('depth-sensing')",xr)
        self.assertIn('options.requireDepth',xr)
        self.assertIn('id="depthXR"',(APP/'frontend/index.html').read_text())
        self.assertIn('window.FreeLabRooms.chooseXR(true)',app)
        self.assertIn('const anchor=point(poseForwardAnchor(pose,.72,-.24)',xr)
        self.assertIn('for(const [button,x] of [[darkPrevious,-.14],[darkNext,0],[darkClose,.14]]',xr)

    def test_visitors_and_shared_frames_default_off(self):
        server=(BACKEND/'app.py').read_text()
        rooms=(ASSETS/'rooms.js').read_text()
        xr=(ASSETS/'xr.js').read_text()
        self.assertIn("@app.get('/api/rooms/mine/visitors')",server)
        self.assertIn('rebuildShapes(payload.shapes)',(ASSETS/'room-viewer.mjs').read_text())
        self.assertIn("window.FreeLab?.pref?.('shareExperimental')",xr)
        self.assertIn('shapes:shapes.slice(0,32)',rooms)
        self.assertIn('presence',{x for x in ['presence'] if '/presence' in rooms})

    def test_voice_batch_requires_second_confirmation_and_caps_calls(self):
        xr=(ASSETS/'xr.js').read_text()
        self.assertIn('if(pending.batch)',xr)
        self.assertIn('Press OK again to charge for each',xr)
        self.assertIn('.slice(0,6)',xr)
        self.assertIn('function parseGlobalStyle(utterance)',xr)
        self.assertIn('mascotMode()===\'none\'',xr)

if __name__=='__main__':
    unittest.main()
