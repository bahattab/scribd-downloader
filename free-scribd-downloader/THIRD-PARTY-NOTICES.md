# Third-party components

Free Scribd Downloader integrates these components without claiming their authorship:

- User-selected rendering source: https://github.com/themrsami/scribd-downloader — original source and local hardening provenance are in `upstream/PROVENANCE.md`. Upstream README states MIT; a root LICENSE was not retrievable during initial inspection. This attribution does not assert that a missing license text was independently verified.
- Python: https://docs.python.org/3/license.html — runtime bundled by PyInstaller.
- PyInstaller: https://pyinstaller.org/en/stable/license.html — bootloader distribution exception applies as documented there.
- Selenium: https://github.com/SeleniumHQ/selenium/blob/trunk/LICENSE — Apache-2.0; package metadata/license files collected with the worker.
- pypdf: https://github.com/py-pdf/pypdf/blob/main/LICENSE — BSD-3-Clause; collected with the worker.
- Node.js: https://github.com/nodejs/node/blob/main/LICENSE — distribution license included as `runtime/NODE-LICENSE.txt`.
- Chrome for Testing and ChromeDriver: https://github.com/GoogleChromeLabs/chrome-for-testing — official unmodified distribution archives retain their notices. Chrome product terms: https://www.google.com/chrome/terms/ . Bundling is not a claim that the browser is authored by this project.
- Windows installer compiler: https://jrsoftware.org/isinfo.php — Inno Setup generates the installer; its source is not bundled.

The historical repository files and their original attribution remain intact. No blanket relicensing of historical or third-party code is intended.
