# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Hormiga server binary.
# Build with:  pyinstaller hormiga.spec --clean --distpath dist

import sys

block_cipher = None

a = Analysis(
    ['app.py'],
    pathex=['.'],
    binaries=[],
    datas=[
        # Static assets bundled into the binary (accessible via sys._MEIPASS)
        ('templates',             'templates'),
        ('static',                'static'),
        ('settings.example.json', '.'),
        # Python source packages (needed when not auto-detected)
        ('core',                  'core'),
        ('data',                  'data'),
        ('schemas',               'schemas'),
        ('services',              'services'),
        ('hormiga_core',          'hormiga_core'),
        # Void Core runtime, vendored by scripts/vendor_voidcore.py (python
        # sources + libvoidcore native lib, laid out like the VoidCore repo).
        # hormiga_core.engine adds this to sys.path when the editable install
        # isn't present — which is always the case in a frozen build.
        ('vendor/voidcore',       'vendor/voidcore'),
    ],
    hiddenimports=[
        # SQLAlchemy PostgreSQL dialect
        'sqlalchemy.dialects.postgresql',
        'sqlalchemy.dialects.postgresql.psycopg2',
        # psycopg2
        'psycopg2',
        'psycopg2.extensions',
        'psycopg2._psycopg',
        # Google auth / gspread
        'google.auth',
        'google.auth.transport',
        'google.auth.transport.requests',
        'google.oauth2',
        'google.oauth2.service_account',
        'gspread',
        # Flask / Werkzeug internals sometimes missed
        'flask',
        'werkzeug',
        'werkzeug.serving',
        'werkzeug.debug',
        'jinja2',
        'markupsafe',
        # Translation
        'deep_translator',
        # Requests
        'requests',
        'urllib3',
        'certifi',
        'charset_normalizer',
        # Void Core adapter (imported lazily inside the /api/dev/cli route)
        'hormiga_core',
        'hormiga_core.engine',
    ],
    # Void Core ships vendored (vendor/voidcore above): python runtime + the
    # native lib built on this machine. Platforms without a built native lib
    # in the vendor dir degrade gracefully (console reports engine unavailable).
    # After updating VoidCore, re-run: python scripts/vendor_voidcore.py
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude heavy packages we don't use
        'tkinter',
        'matplotlib',
        'numpy',
        'pandas',
        'scipy',
        'IPython',
        'jupyter',
        'notebook',
        'pytest',
    ],
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
    a.datas,
    [],
    name='hormiga-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    # console=True so the process can write to stdout/stderr pipes from Electron.
    # This shows no window on Mac/Linux; on Windows a console window appears
    # briefly — will be fixed in a future build (windowed + proper stdio bridge).
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
