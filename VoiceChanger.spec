# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

block_cipher = None

sys.path.append(os.path.abspath("server"))

added_files = [
    ('server/voice_changer', 'voice_changer'),
    ('server/restapi', 'restapi'),
    ('server/sio', 'sio'),
    ('server/downloader', 'downloader'),
    ('server/const.py', '.'),
    ('server/Exceptions.py', '.'),
    ('server/GetModelInfo.py', '.'),
    ('client/demo/dist', 'dist'),
    ('extension', 'extension'),
]

added_files += collect_data_files('torch')
added_files += collect_data_files('librosa')

# onnxruntime's provider DLLs (DirectML.dll, onnxruntime_providers_*.dll) are not
# always picked up by analysis; without them ONNX inference silently loses GPU support.
added_binaries = collect_dynamic_libs('onnxruntime')

a = Analysis(
    ['server/MMVCServerSIO.py'],
    pathex=[],
    binaries=added_binaries,
    datas=added_files,
    hiddenimports=[
        'engineio.async_drivers.eventlet',
        'eventlet.hubs.epolls',
        'eventlet.hubs.kqueue',
        'eventlet.hubs.selects',
        'sklearn.utils._typedefs',
        'sklearn.utils._heap',
        'sklearn.utils._sorting',
        'sklearn.utils._vector_sentinel',
        'pyttsx3.drivers',
        'pyttsx3.drivers.sapi5',
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
    exclude_binaries=False,
    name='VoiceChanger',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX corrupts torch/onnxruntime DLLs
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
