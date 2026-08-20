{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.korgo-ssh-client;

  ipv4Parts = lib.splitString "." cfg.miniAddress;
  validIpv4Part =
    part:
    builtins.match "[0-9]+" part != null
    && (builtins.stringLength part == 1 || !lib.hasPrefix "0" part)
    && builtins.fromJSON part >= 0
    && builtins.fromJSON part <= 255;
  validIpv4 = builtins.length ipv4Parts == 4 && lib.all validIpv4Part ipv4Parts;

  # Full IPv6 syntax is also parsed by systemd's IPAddressAllow directive.
  # This first pass excludes hostnames, zones, CIDRs, options, and shell text.
  validIpv6 =
    lib.hasInfix ":" cfg.miniAddress
    && builtins.match "[0-9A-Fa-f:]+" cfg.miniAddress != null
    && cfg.miniAddress != "::";
  validTailscaleIpv4 =
    validIpv4
    && builtins.fromJSON (builtins.elemAt ipv4Parts 0) == 100
    && builtins.fromJSON (builtins.elemAt ipv4Parts 1) >= 64
    && builtins.fromJSON (builtins.elemAt ipv4Parts 1) <= 127;
  validTailscaleIpv6 = validIpv6 && lib.hasPrefix "fd7a:115c:a1e0:" (lib.toLower cfg.miniAddress);

  miniCidr = if validIpv4 then "${cfg.miniAddress}/32" else "${cfg.miniAddress}/128";
  runtimeDir = "/run/user/${toString cfg.uid}";
  waylandSocket = "${runtimeDir}/${cfg.waylandDisplay}";
  sourcePathIsDedicated = path:
    (lib.hasPrefix "/run/" path || lib.hasPrefix "/var/" path)
    && !lib.hasPrefix "/run/user/" path
    && !lib.hasInfix "/../" path
    && !lib.hasInfix "/./" path
    && !lib.hasInfix "//" path;
  execStart = lib.escapeShellArgs (
    [ (lib.getExe cfg.package) ]
    ++ lib.optionals (cfg.containmentProbeArguments != [ ]) (
      [ "--containment-probe" ] ++ cfg.containmentProbeArguments
    )
  );
  knownHostsLookup =
    if cfg.port == 22 then cfg.miniAddress else "[${cfg.miniAddress}]:${toString cfg.port}";
  knownHostsPreflight = import ./korgo-known-hosts-preflight.nix { inherit lib pkgs; } {
    knownHostsFile = "/run/korgo-ssh/known_hosts";
    knownHostsSha256 = cfg.knownHostsSha256;
    lookup = knownHostsLookup;
    hostKeyFingerprint = cfg.hostKeyFingerprint;
  };

  preflight = pkgs.writeShellScript "korgo-ssh-client-preflight" ''
    set -euo pipefail

    fail() {
      echo "korgo-ssh-client preflight: $*" >&2
      exit 1
    }

    identity=/run/korgo-ssh/identity
    known_hosts=/run/korgo-ssh/known_hosts

    [ -f '${cfg.identityFile}' ] && [ ! -L '${cfg.identityFile}' ] || fail "identity source must be a regular, non-symlink file"
    [ -f '${cfg.knownHostsFile}' ] && [ ! -L '${cfg.knownHostsFile}' ] || fail "known_hosts source must be a regular, non-symlink file"
    [ -f "$identity" ] && [ ! -L "$identity" ] || fail "identity must be one regular, non-symlink file"
    [ -f "$known_hosts" ] && [ ! -L "$known_hosts" ] || fail "known_hosts must be one regular, non-symlink file"
    [ "$(stat -c %u -- "$identity")" = ${toString cfg.uid} ] || fail "identity owner is not the configured user"
    case "$(stat -c %a -- "$identity")" in 400|600) ;; *) fail "identity mode must be 0400 or 0600" ;; esac
    [ "$(stat -c %u -- "$known_hosts")" = ${toString cfg.uid} ] || fail "known_hosts owner is not the configured user"
    case "$(stat -c %a -- "$known_hosts")" in 400|600) ;; *) fail "known_hosts mode must be 0400 or 0600" ;; esac

    ${knownHostsPreflight}

    [ -S '${waylandSocket}' ] && [ ! -L '${waylandSocket}' ] || fail "configured Wayland socket is absent or symlinked"
  '';
  serviceEntry = pkgs.writeShellScript "korgo-ssh-client-entry" ''
    set -euo pipefail

    # Keep validation and launch in one systemd-created mount namespace. An
    # ExecStartPre process would get a separate BindReadOnlyPaths resolution.
    ${preflight}
    exec ${execStart}
  '';
in
{
  options.services.korgo-ssh-client = with lib; {
    enable = mkEnableOption "the system-managed, contained Korgo SSH-only desktop client";

    package = mkOption {
      type = types.package;
      description = "C11.1 Korgo package built with both reviewed Electron fixed-output hashes.";
    };

    user = mkOption {
      type = types.strMatching "[a-z_][a-z0-9_-]*";
      description = "Existing unprivileged desktop user that runs the system service.";
    };

    group = mkOption {
      type = types.strMatching "[a-z_][a-z0-9_-]*";
      description = "Existing primary group for the desktop user.";
    };

    uid = mkOption {
      type = types.ints.positive;
      description = "Numeric UID used to name the one allowed Wayland runtime socket.";
    };

    identityFile = mkOption {
      type = types.strMatching "/[A-Za-z0-9._/+-]+";
      description = "Host path to the dedicated Korgo private key; never copied into the Nix store.";
    };

    knownHostsFile = mkOption {
      type = types.strMatching "/[A-Za-z0-9._/+-]+";
      description = "Host path owned by the configured user to the out-of-band verified dedicated known_hosts file with exactly one Mini host/port key entry.";
    };

    knownHostsSha256 = mkOption {
      type = types.strMatching "[0-9A-Fa-f]{64}";
      description = "Reviewed SHA256 manifest for the exact known_hosts file contents.";
    };

    hostKeyFingerprint = mkOption {
      type = types.strMatching "SHA256:[A-Za-z0-9+/]{43}";
      description = "Out-of-band verified OpenSSH SHA256 fingerprint for the one exact Mini host/port key entry.";
    };

    miniAddress = mkOption {
      type = types.str;
      description = "Stable numeric Mini Tailscale IPv4 or IPv6 address, without a prefix or hostname.";
    };

    port = mkOption {
      type = types.port;
      default = 22;
      description = "Mini SSH port represented by the pre-seeded known_hosts entry.";
    };

    waylandDisplay = mkOption {
      type = types.strMatching "wayland-[0-9]+";
      default = "wayland-1";
      description = "One exact Wayland socket basename; the runtime directory is never broadly bound.";
    };

    memoryMax = mkOption {
      type = types.str;
      default = "2G";
      description = "systemd MemoryMax limit for the contained client.";
    };

    containmentProbeArguments = mkOption {
      type = types.listOf types.str;
      default = [ ];
      example = [
        "--forbid"
        "/tmp/korgo-dummy-home-marker"
        "--expect-denied"
        "192.0.2.1:9"
      ];
      description = ''
        Dummy-only G3 probe arguments. A non-empty list selects the package's
        fixed containment probe instead of Electron; arbitrary executables are
        never accepted. Remove this setting before real inputs or G5.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = validTailscaleIpv4 || validTailscaleIpv6;
        message = "services.korgo-ssh-client.miniAddress must be one numeric address in Tailscale's 100.64.0.0/10 or fd7a:115c:a1e0::/48 ranges";
      }
      {
        assertion = builtins.hasAttr cfg.user config.users.users;
        message = "services.korgo-ssh-client.user must name a declaratively managed NixOS user";
      }
      {
        assertion =
          !builtins.hasAttr cfg.user config.users.users
          || config.users.users.${cfg.user}.uid == cfg.uid;
        message = "services.korgo-ssh-client.uid must equal an explicitly configured NixOS user UID";
      }
      {
        assertion =
          builtins.hasAttr cfg.group config.users.groups
          && (
            !builtins.hasAttr cfg.user config.users.users
            || config.users.users.${cfg.user}.group == cfg.group
          );
        message = "services.korgo-ssh-client.group must be the configured user's declarative primary group";
      }
      {
        assertion = cfg.identityFile != cfg.knownHostsFile;
        message = "Korgo identityFile and knownHostsFile must be distinct files";
      }
      {
        assertion = sourcePathIsDedicated cfg.identityFile && sourcePathIsDedicated cfg.knownHostsFile;
        message = "Korgo SSH source files must use a dedicated /run or /var path, not home, temporary, per-user runtime, or Nix store state";
      }
    ];

    # A system service is intentional. User managers can ignore IPAddressDeny
    # on hosts where they cannot attach the required cgroup BPF program. The
    # system manager owns this policy while the process still runs as cfg.user.
    systemd.services.korgo-ssh-client = {
      description = "Contained Korgo SSH-only desktop client";
      documentation = [ "file://${../docs/korgo-linux-ssh-only.md}" ];
      after = [
        "graphical.target"
        "network-online.target"
      ];
      wants = [ "network-online.target" ];

      unitConfig = {
        # systemd has no ConditionPathIsRegular directive. Existence is a
        # cheap unit condition; the same-namespace ExecStart wrapper then
        # requires a regular, non-symlink file, strict mode/owner, manifest,
        # and fingerprint.
        ConditionPathExists = [
          cfg.identityFile
          cfg.knownHostsFile
        ];
        StartLimitBurst = 3;
        StartLimitIntervalSec = "60s";
      };

      environment = {
        KORGO_DATA_DIR = "/var/lib/korgo-ssh-client";
        KORGO_CACHE_DIR = "/var/cache/korgo-ssh-client";
        XDG_RUNTIME_DIR = runtimeDir;
        WAYLAND_DISPLAY = cfg.waylandDisplay;
      };

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        ExecStart = serviceEntry;
        UMask = "0077";

        RuntimeDirectory = "korgo-ssh";
        RuntimeDirectoryMode = "0500";
        StateDirectory = "korgo-ssh-client";
        StateDirectoryMode = "0700";
        CacheDirectory = "korgo-ssh-client";
        CacheDirectoryMode = "0700";
        BindReadOnlyPaths = [
          "${cfg.identityFile}:/run/korgo-ssh/identity"
          "${cfg.knownHostsFile}:/run/korgo-ssh/known_hosts"
        ];

        NoNewPrivileges = true;
        PrivateTmp = "disconnected";
        PrivateDevices = true;
        DevicePolicy = "closed";
        ProtectSystem = "strict";
        ProtectHome = "tmpfs";
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectKernelLogs = true;
        ProtectControlGroups = true;
        ProtectClock = true;
        ProtectHostname = true;
        RestrictAddressFamilies = [
          "AF_UNIX"
          "AF_INET"
          "AF_INET6"
        ];
        IPAddressDeny = "any";
        IPAddressAllow = [
          "127.0.0.0/8"
          "::1/128"
          miniCidr
        ];
        CapabilityBoundingSet = "";
        AmbientCapabilities = "";
        RestrictSUIDSGID = true;
        LockPersonality = true;
        KeyringMode = "private";
        SystemCallArchitectures = "native";

        MemoryMax = cfg.memoryMax;
        TasksMax = 512;
        LimitNOFILE = 4096;
        Restart = "on-failure";
        RestartSec = "5s";
        TimeoutStartSec = "45s";
        TimeoutStopSec = "20s";
      };
    };

    # The system manager watches the one reviewed Wayland socket. This avoids
    # both a boot-time race and a package desktop entry that could bypass the
    # service cgroup's IP allowlist.
    systemd.paths.korgo-ssh-client = {
      description = "Activate Korgo when the reviewed Wayland socket appears";
      wantedBy = [ "multi-user.target" ];
      pathConfig.PathChanged = waylandSocket;
    };
  };
}
