# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from PyInstaller.utils.hooks import collect_data_files

block_cipher = None

# Add the server directory to the path so we can find local modules
sys.path.append(os.path.abspath('server'))

added_files = [
    ('server/voice_changer', 'voice_changer'),
    ('server/downloader', 'downloader'),
    ('server/restapi', 'restapi'),
    ('server/sio', 'sio'),
    ('server/const.py', '.'),
    ('server/Exceptions.py', '.'),
    ('server/GetModelInfo.py', '.'),
    ('docs', 'docs'), # Include the web client docs
]

# Collect data files for heavy libraries
added_files += collect_data_files('torch')
added_files += collect_data_files('librosa')

a = Analysis(
    ['server/MMVCServerSIO.py'],
    pathex=[],
    binaries=[],
    datas=added_files,
    hiddenimports=[
        'engineio.async_drivers.threading',
        'eventlet.hubs.epolls',
        'eventlet.hubs.kqueue',
        'eventlet.hubs.selects',
        'sklearn.utils._typedefs',
        'sklearn.utils._heap',
        'sklearn.utils._sorting',
        'sklearn.utils._vector_sentinel',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'notebook', 'jedi'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='VoiceChanger',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True, # Use UPX compression to further reduce size
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
