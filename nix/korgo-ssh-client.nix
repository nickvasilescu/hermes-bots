{
  pkgs,
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  makeWrapper,
  unzip,
  bash,
  bubblewrap,
  coreutils,
  gnugrep,
  netcat-openbsd,
  openssh,
  hermesNpmLib,
  electronArchiveHash ? "sha256-edTv1p8Mzx/BGJHqUHUynHs/rdrXmgjZ+zlbvWMWms8=",
  electronHeadersHash ? "sha256-CyzcARd1+GhWr8ED7HBYW2MYD+tgetqZFMkaivaGvw0=",
}:

let
  electronVersion = "43.4.1";
  isPinnedSha256 =
    hash:
    hash != null
    && builtins.isString hash
    && builtins.match "sha256-[A-Za-z0-9+/]+={0,2}" hash != null
    && hash != lib.fakeHash;
in
assert lib.assertMsg stdenv.hostPlatform.isx86_64
  "korgo-ssh-client is currently defined only for the reviewed x86_64 Linux artifact";
assert lib.assertMsg stdenv.hostPlatform.isLinux "korgo-ssh-client is a Linux-only package";
assert lib.assertMsg (isPinnedSha256 electronArchiveHash) ''
  korgo-ssh-client requires electronArchiveHash, the independently verified
  C11.1 SRI SHA256 for electron-v43.4.1-linux-x64.zip
'';
assert lib.assertMsg (isPinnedSha256 electronHeadersHash) ''
  korgo-ssh-client requires electronHeadersHash, the independently verified
  C11.1 SRI SHA256 for node-v43.4.1-headers.tar.gz
'';

let
  electronArchive = fetchurl {
    url = "https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-linux-x64.zip";
    hash = electronArchiveHash;
  };

  electronHeaders = fetchurl {
    url = "https://artifacts.electronjs.org/headers/dist/v${electronVersion}/node-v${electronVersion}-headers.tar.gz";
    hash = electronHeadersHash;
  };

  # Only the runtime libraries are reused from nixpkgs. The Electron binary is
  # the fixed v43.4.1 distribution above, never nixpkgs' Electron package.
  electronRuntimeLibraries = pkgs.electron.unwrapped.buildInputs;

  # Kept separate so the probe can run under the exact same bwrap and systemd
  # boundary without accepting an arbitrary executable override.
  containmentProbe = stdenv.mkDerivation {
    pname = "korgo-ssh-client-containment-probe";
    version = "1";
    dontUnpack = true;
    nativeBuildInputs = [ makeWrapper ];
    installPhase = ''
      runHook preInstall
      install -Dm0755 ${../packaging/korgo-ssh-client/korgo-ssh-client-containment-probe} \
        $out/bin/korgo-ssh-client-containment-probe
      patchShebangs $out/bin/korgo-ssh-client-containment-probe
      wrapProgram $out/bin/korgo-ssh-client-containment-probe \
        --prefix PATH : ${
          lib.makeBinPath [
            coreutils
            netcat-openbsd
          ]
        }
      runHook postInstall
    '';
  };

  unpackedApp = hermesNpmLib.buildNpmPackage {
    dirs = [
      "apps/desktop"
      "apps/shared"
    ];
    pname = "korgo-ssh-client-unpacked";
    version = electronVersion;

    nativeBuildInputs = [ unzip ];

    HERMES_DESKTOP_PRODUCT = "bot";
    VITE_HERMES_DESKTOP_PRODUCT = "bot";
    HERMES_DESKTOP_SKU = "bot-ssh-only";
    VITE_HERMES_DESKTOP_SKU = "bot-ssh-only";

    doCheck = true;

    buildPhase = ''
      runHook preBuild
      patchShebangs .

      mkdir -p "$TMPDIR/electron-dist" "$TMPDIR/release"

      pushd apps/desktop
        npm exec -- tsc -b
        npm exec -- vite build
        node scripts/bundle-electron-main.mjs

        mkdir -p "$TMPDIR/electron-headers"
        tar -xzf ${electronHeaders} -C "$TMPDIR/electron-headers" --strip-components=1
        ${lib.getExe hermesNpmLib.node-gyp} rebuild \
          --directory=../../node_modules/node-pty \
          --build-from-source \
          --runtime=electron \
          --target=${electronVersion} \
          --nodedir="$TMPDIR/electron-headers" \
          --disturl="" \
          --offline
        node scripts/stage-native-deps.mjs linux x64

        npm run postbuild

        unzip -q ${electronArchive} -d "$TMPDIR/electron-dist"
        test "$(cat "$TMPDIR/electron-dist/version")" = "${electronVersion}" || {
          echo "Electron distribution version is not ${electronVersion}" >&2
          exit 1
        }

        # --dir produces the unpacked tree used by bwrap. No AppImage/FUSE or
        # network fetch is involved, and SKU build policy owns excluded files.
        HERMES_DESKTOP_ELECTRON_DIST="$TMPDIR/electron-dist" node scripts/run-electron-builder.mjs \
          --dir \
          -c.electronDist="$TMPDIR/electron-dist" \
          -c.directories.output="$TMPDIR/release" \
          '-c.extraResources=[]'
      popd
      runHook postBuild
    '';

    checkPhase = ''
      runHook preCheck
      app="$TMPDIR/release/linux-unpacked"
      test -x "$app/Korgo Bot"
      test "$(cat "$app/version")" = "${electronVersion}"
      test -f "$app/resources/app.asar"
      test -f "$app/resources/app.asar.unpacked/dist/node_modules/node-pty/build/Release/pty.node"
      test ! -e "$app/resources/orgo"
      test -f apps/desktop/dist/node_modules/node-pty/build/Release/pty.node
      runHook postCheck
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p $out/libexec/korgo-ssh-client
      cp -a "$TMPDIR/release/linux-unpacked/." $out/libexec/korgo-ssh-client/
      runHook postInstall
    '';
  };

in
stdenv.mkDerivation {
  pname = "korgo-ssh-client";
  version = electronVersion;
  dontUnpack = true;

  nativeBuildInputs = [
    autoPatchelfHook
    makeWrapper
  ];

  # Electron v43 uses the same Linux runtime surface as the nixpkgs Electron
  # package. autoPatchelf records these libraries in the fixed binary's RPATH.
  buildInputs = electronRuntimeLibraries;

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin $out/libexec $out/share/icons/hicolor/1024x1024/apps
    cp -a ${unpackedApp}/libexec/korgo-ssh-client $out/libexec/
    install -Dm0644 ${../apps/desktop/assets/korgo-bot-icon.png} \
      $out/share/icons/hicolor/1024x1024/apps/korgo-bot.png

    install -m0755 ${../packaging/korgo-ssh-client/korgo-ssh-client-bwrap} \
      $out/bin/korgo-ssh-client
    substituteInPlace $out/bin/korgo-ssh-client \
      --replace-fail '@bash@' '${bash}' \
      --replace-fail '@bwrap@' '${lib.getExe bubblewrap}' \
      --replace-fail '@app_executable@' "'$out/libexec/korgo-ssh-client/Korgo Bot'" \
      --replace-fail '@probe_executable@' "'${containmentProbe}/bin/korgo-ssh-client-containment-probe'" \
      --replace-fail '@runtime_path@' '${
        lib.makeBinPath [
          coreutils
          gnugrep
          netcat-openbsd
          openssh
        ]
      }'
    runHook postInstall
  '';

  passthru = {
    inherit
      containmentProbe
      electronArchive
      electronHeaders
      electronVersion
      ;
    requiredFixedOutputInputs = {
      inherit electronArchiveHash electronHeadersHash;
    };
  };

  meta = with lib; {
    description = "Contained, SSH-only Korgo Bot desktop client";
    homepage = "https://github.com/nickvasilescu/hermes-bots";
    license = licenses.mit;
    platforms = [ "x86_64-linux" ];
    mainProgram = "korgo-ssh-client";
  };
}
