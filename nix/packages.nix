# nix/packages.nix — Hermes Agent package built with uv2nix
{ inputs, ... }:
{
  perSystem =
    {
      pkgs,
      lib,
      inputs',
      ...
    }:
    let

      sandbox = pkgs.callPackage ./sandbox.nix { };

      minimal = pkgs.callPackage ./hermes-agent.nix {
        inherit (inputs) uv2nix pyproject-nix pyproject-build-systems;
        npm-lockfile-fix = inputs'.npm-lockfile-fix.packages.default;
        # Only embed clean revs — dirtyRev doesn't represent any upstream
        # commit, so comparing it would always claim "update available".
        rev = inputs.self.rev or null;
      };

      # All platform-portable optional integrations pre-built.
      full = minimal.override {
        extraDependencyGroups = [
          "anthropic"
          "azure-identity"
          "bedrock"
          "daytona"
          "dingtalk"
          "edge-tts"
          "exa"
          "fal"
          "feishu"
          "firecrawl"
          "hindsight"
          "honcho"
          "messaging"
          "modal"
          "parallel-web"
          "tts-premium"
          "vercel"
          "voice"
        ]
        # matrix is Linux-only (oqs/liboqs lacks aarch64-darwin wheels).
        ++ lib.optionals pkgs.stdenv.isLinux [ "matrix" ];
      };

      # C11.1 pins both fixed-output inputs. Callers may override them only to
      # perform an explicit future Electron upgrade review.
      korgoSshClientBuilder =
        {
          electronArchiveHash ? "sha256-edTv1p8Mzx/BGJHqUHUynHs/rdrXmgjZ+zlbvWMWms8=",
          electronHeadersHash ? "sha256-CyzcARd1+GhWr8ED7HBYW2MYD+tgetqZFMkaivaGvw0=",
        }:
        pkgs.callPackage ./korgo-ssh-client.nix {
          inherit electronArchiveHash electronHeadersHash;
          hermesNpmLib = full.hermesNpmLib;
        };
    in
    {
      legacyPackages.korgoSshClientBuilder = korgoSshClientBuilder;

      packages = {
        node-gyp =
          (pkgs.callPackage ./lib.nix {
            inherit (pkgs) npm-lockfile-fix;
          }).node-gyp;
        default = full;

        inherit sandbox;

        inherit minimal;

        # Ships discord.py + python-telegram-bot + slack-sdk so a plain
        # `nix profile install .#messaging` connects to Discord/Telegram/Slack
        # on first run — lazy-install can't write to the read-only /nix/store.
        messaging = minimal.override {
          extraDependencyGroups = [ "messaging" ];
        };

        tui = full.hermesTui;
        web = full.hermesWeb;
        desktop = full.hermesDesktop;

        update-npm-lockfile = full.hermesNpmLib.updateNpmLockfile;
      } // lib.optionalAttrs (pkgs.stdenv.hostPlatform.isLinux && pkgs.stdenv.hostPlatform.isx86_64) {
        korgo-ssh-client = korgoSshClientBuilder { };
      };
    };
}
