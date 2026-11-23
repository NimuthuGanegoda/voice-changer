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
    ('server/mods', 'mods'),
    ('server/data', 'data'),
    ('server/downloader', 'downloader'),
    ('server/model_dir_static', 'model_dir_static'),
    ('server/const.py', '.'),
    ('server/Exceptions.py', '.'),
    ('server/GetModelInfo.py', '.'),
    ('client/demo/dist', 'dist'),
    ('extension', 'extension'),
    ('setup_virtual_mic_windows.ps1', '.'),
]

added_files += collect_data_files('torch')
added_files += collect_data_files('librosa')

# onnxruntime's provider DLLs (DirectML.dll, onnxruntime_providers_*.dll) are not
# always picked up by analysis; without them ONNX inference silently loses GPU support.
added_binaries = collect_dynamic_libs('onnxruntime')

a = Analysis(
    ['server/MMVCServerSIO.py'],
    pathex=[os.path.abspath("server")],
    binaries=added_binaries,
    datas=added_files,
    hiddenimports=[
        'sklearn.utils._typedefs',
        'sklearn.utils._heap',
        'sklearn.utils._sorting',
        'sklearn.utils._vector_sentinel',
        'pyttsx3.drivers',
        'pyttsx3.drivers.sapi5',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'engineio.async_drivers.asgi',
        'voice_changer.utils.PresetManager',
        'voice_changer.utils.AtomicFile',
        'voice_changer.utils.Soundboard',
        'voice_changer.utils.ModelImport',
        'voice_changer.utils.ModelPaths',
        'voice_changer.utils.RvcArchive',
        'voice_changer.utils.TrustedAssets',
        'voice_changer.utils.TrustedCheckpoint',
        'voice_changer.RVC.RVCr2',
        'voice_changer.RVC.RVCModelSlotGenerator',
        'voice_changer.RVC.embedder.OnnxContentvec',
        'voice_changer.RVC.embedder.Whisper',
        'downloader.CommunitySamples',
        'restapi.mods.trustedorigin',
        'mods.auth',
        'mods.origins',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'notebook', 'jedi'],
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
    icon='docs/favicon.ico' if os.path.exists('docs/favicon.ico') else None,
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
