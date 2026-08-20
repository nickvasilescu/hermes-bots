# Korgo Linux SSH-only operations

This runbook takes a reviewed Git revision through a credential-free build,
dummy containment proof, staged Mini proof, explicit live authorization, and
rollback. It does not authorize live cutover. Stop at every gate until its
named evidence is complete.

## Ownership model

Mini owns Hermes configuration, credentials, profiles, cron, messaging, MCPs,
and WebCTX. The Korgo client owns only local connection/UI state, its dedicated
data/cache, and its SSH-tunnel lifecycle. WebCTX stays Mini-local at
`127.0.0.1:8090` and is reached through Hermes; Korgo never connects to WebCTX
directly. Closing the GUI must not stop Mini's gateway, WebCTX, cron, or
messaging.

## Forbidden workarounds

Never use a source/dev credential launch, `dev:mock`, `--no-sandbox`, CDP,
SSH-agent authentication or forwarding, TOFU, a local Hermes bootstrap,
provider/Orgo/Composio credential entry, a broad home or `/run/user/$UID` bind,
broad egress, AppImage/FUSE fallback, an unlocked download, or a packaged file
copied from gitignored `apps/desktop/release/`. A failed control blocks the
gate; it is not permission to widen the boundary.

## Inputs

Record these non-secret inputs before building:

- reviewed Git SHA and clean/unrelated-change inventory;
- Electron `v43.4.1` Linux x64 archive SRI SHA256;
- Electron `v43.4.1` headers archive SRI SHA256;
- package and later artifact SHA256;
- existing unprivileged NixOS user, group, and numeric UID;
- exact Wayland socket basename;
- stable numeric Mini Tailscale address and SSH port;
- after G4 only: dedicated identity path, verified known-hosts path containing
  exactly one key for the Mini address/port, its file SHA256, and that exact
  key's out-of-band verified `SHA256:...` fingerprint; and
- staged Hermes home/profile, expected Hermes `0.20.4`, commit
  `c820a5d38321a8d870e5b1ed0d89f8b933dd48e8`, and schema `26`.

Do not put private-key contents, gateway tokens, provider secrets, or raw
credential-bearing logs into the evidence manifest.

## G0-G2: build and uncredentialed artifact proof

1. Record `git rev-parse HEAD` and `git status --short`. Preserve unrelated
   changes. Use the reviewed `feat/linux-ssh-client` branch; do not switch if it
   would overwrite work.
2. In an uncredentialed environment, run `npm ci --ignore-scripts`, inspect the
   lock-resolved install scripts for exactly `electron@43.4.1`,
   `esbuild@0.28.1`, and `node-pty@1.1.0`, then rebuild only those packages.
   Run `uv sync --locked` without fallback.
3. Fetch the two official fixed inputs with `nix store prefetch-file --json`.
   Verify the Linux Electron archive digest against the release's
   `SHASUMS256.txt`; record the headers digest independently. Do not substitute
   a cache checksum, `lib.fakeHash`, or guessed value.

   ```bash
   nix store prefetch-file --json \
     https://github.com/electron/electron/releases/download/v43.4.1/electron-v43.4.1-linux-x64.zip
   nix store prefetch-file --json \
     https://artifacts.electronjs.org/headers/dist/v43.4.1/node-v43.4.1-headers.tar.gz
   nix store prefetch-file --json \
     https://github.com/electron/electron/releases/download/v43.4.1/SHASUMS256.txt
   ```

   Compare the archive's hex SHA256 to its exact `SHASUMS256.txt` row, then
   preserve the two prefetch `hash` values (SRI form) in reviewed evidence.
4. Confirm the reviewed pins remain unchanged: the Electron archive is
   `sha256-edTv1p8Mzx/BGJHqUHUynHs/rdrXmgjZ+zlbvWMWms8=` and the headers are
   `sha256-CyzcARd1+GhWr8ED7HBYW2MYD+tgetqZFMkaivaGvw0=`. The package is exposed
   only as `packages.x86_64-linux.korgo-ssh-client`; any Electron upgrade must
   repeat the independent archive/checksum review before changing either pin.
5. Run:

   ```bash
   nix flake check --no-build
   nix build .#korgo-ssh-client
   nix build .#checks.x86_64-linux.korgo-ssh-client-containment
   systemd-analyze verify packaging/korgo-ssh-client/korgo-ssh-client.service
   npm --workspace apps/desktop run pack:bot:linux:ssh-only
   npm --workspace apps/desktop run dist:bot:linux:ssh-only
   npm --workspace apps/desktop run verify:bot:linux:ssh-only
   xvfb-run --auto-servernum \
     npm --workspace apps/desktop run test:e2e:bot:linux:ssh-only
   korgo_package="$(nix build .#korgo-ssh-client --no-link --print-out-paths)"
   nix shell --inputs-from . \
     nixpkgs#bash nixpkgs#bubblewrap nixpkgs#coreutils nixpkgs#gnugrep \
     nixpkgs#gnused nixpkgs#xorg.xorgserver \
     --command ./packaging/korgo-ssh-client/korgo-ssh-client-no-dbus-smoke \
     "$korgo_package"
   ```

Expected: the source build uses the committed lockfile and fixed Electron
distribution/headers, reports Electron 43.4.1, produces an unpacked runtime
instead of using FUSE, and the bundle/security scans have zero banned findings.
The bubblewrap/Xvfb smoke must keep Electron alive for eight seconds with no
session D-Bus transport. Complete the full type/lint/unit/package matrix and
record the AppImage and `linux-unpacked` SHA256 values required by G2. No real
identity, known-hosts, or Mini access is allowed yet.

Stop if a build downloads anything not pinned, consumes `release/`, reports a
different Electron version, omits a mandatory artifact/test, disables Chromium
sandboxing, opens CDP, or contains local bootstrap/provider/Orgo/Composio code.

## G3: install and prove containment with dummy inputs

Import `nixosModules.korgo-ssh-client` in a separate Carter-reviewed dotfiles
patch. The operational configuration shape is:

```nix
services.korgo-ssh-client = {
  enable = true;
  package = inputs.korgo.packages.x86_64-linux.korgo-ssh-client;
  user = "(reviewed desktop user)";
  group = "(reviewed desktop group)";
  uid = 1000; # reviewed numeric UID
  miniAddress = "(staged numeric Mini Tailscale address)";
  port = 22;
  waylandDisplay = "wayland-1";
  identityFile = "/absolute/path/to/dummy_identity";
  knownHostsFile = "/absolute/path/to/dummy_known_hosts";
  knownHostsSha256 = "(64 hex characters for dummy_known_hosts)";
  hostKeyFingerprint = "SHA256:(dummy key fingerprint)";
  containmentProbeArguments = [
    "--forbid" "/path/to/dummy-home-marker"
    "--expect-connect" "127.0.0.1:TEST_PORT"
    "--expect-denied" "PUBLIC_NUMERIC_IP:TEST_PORT"
  ];
};
```

Use only dummy key material and a non-secret test listener. Review the exact
host module path, run `nh os build ~/dotfiles`, and inspect the generated unit.
Carter alone applies the privileged `nrs`. The source module deliberately uses
a system service running as the configured user: a user manager may be unable
to enforce cgroup IP rules and is not an acceptable fallback.

The system manager watches for the configured exact Wayland socket to appear
and starts the service in its own cgroup; the package launcher refuses direct
execution outside that cgroup. If the socket already exists when the module is
first applied, start the unit through the system manager for that initial dummy
test. Closing Korgo does not immediately relaunch it; the next socket creation
at login is a new activation event. The generated `ExecStart` wrapper validates
the bound SSH inputs and immediately `exec`s the launcher in the same mount
namespace; do not split that validation into `ExecStartPre`. Confirm
`systemctl show korgo-ssh-client` reports `IPAddressDeny=any`, loopback plus only
the staged Mini `/32` or `/128`, and the expected hardening. Run the fixed probe by setting
`containmentProbeArguments` in the dummy module config:

```text
--forbid /path/to/dummy-home-marker \
  --forbid /path/to/dummy-ssh-marker \
  --forbid /path/to/dummy-hermes-marker \
  --forbid /path/to/dummy-credential-marker \
  --expect-connect 127.0.0.1:TEST_PORT \
  --expect-connect MINI_NUMERIC_IP:TEST_PORT \
  --expect-denied PUBLIC_NUMERIC_IP:TEST_PORT \
  --expect-denied LAN_NUMERIC_IP:TEST_PORT \
  --expect-denied OTHER_TAILNET_NUMERIC_IP:TEST_PORT
```

Use controlled non-secret listeners so a timeout is meaningful. Also test the
metadata address if applicable. Expected: marker stats fail, `SSH_AUTH_SOCK` is
absent, `DBUS_SESSION_BUS_ADDRESS` and the raw session-bus socket are absent,
Secret Service and the user systemd manager are unreachable, only the fixed
dummy SSH inputs are visible and read-only, loopback and the exact staged Mini
connect, and every other route is denied. If systemd ignores an IP directive,
stop. Use a corrected declarative system-service or dedicated
network-namespace/nftables design; never widen egress.

Remove `containmentProbeArguments` and re-review/rebuild the host configuration
before G4/G5. The service must never select probe mode while real inputs are in
use.

## Host-key pre-seeding after G4

`ssh-keyscan` only collects candidate material. It does not authenticate Mini
and cannot establish trust. Verify the fingerprint through an independent,
already trusted channel before installing the candidate:

```bash
ssh-keyscan -p SSH_PORT MINI_NUMERIC_IP > candidate_known_hosts
ssh-keygen -lf candidate_known_hosts -E sha256
sha256sum candidate_known_hosts
```

`ssh-keyscan` may return several key algorithms. Select exactly one Mini
address/port line whose `SHA256:...` fingerprint you verified out-of-band, and
discard the other candidate lines. Keep the literal numeric host/port field;
markers, aliases, wildcards, and hashed hostnames are rejected by preflight. On
any mismatch, stop and discard the candidate; never accept on first connection
or overwrite an existing record in-app. After G4 permits real inputs, install
that one-line file owned by the configured unprivileged service user with mode
`0400` or `0600`, and record its content SHA256. Root ownership is rejected
because the service runs without privilege and must validate/read both fixed
SSH inputs itself. The module verifies the file hash, requires exactly one key
for the exact Mini host/port, and computes the fingerprint from that matching
key before Electron starts. A verified key elsewhere in the file cannot
authorize a different Mini key. Create a dedicated identity with no reuse and
no agent or forwarding; keep it owned by that same service user.

A reviewed host-secret path under `/run` or `/var` is required. After the G4
decision, the human/operator may create the dedicated key and install the
verified candidate with commands equivalent to:

```bash
install -d -o REVIEWED_USER -g REVIEWED_GROUP -m 0700 /var/lib/korgo-ssh-secrets
ssh-keygen -t ed25519 -N '' \
  -C korgo-ssh-client -f /var/lib/korgo-ssh-secrets/identity
chown REVIEWED_USER:REVIEWED_GROUP /var/lib/korgo-ssh-secrets/identity
install -o REVIEWED_USER -g REVIEWED_GROUP -m 0600 candidate_known_hosts \
  /var/lib/korgo-ssh-secrets/known_hosts
sha256sum /var/lib/korgo-ssh-secrets/known_hosts
```

These are host-side preparation commands, not authorization to add the public
key to authoritative Mini. The staged G5 operator separately authorizes the
key on the non-authoritative test target. Never place it in an SSH agent.

The contained connection form accepts only:

- numeric Mini host;
- SSH user and port;
- identity path exactly `/run/korgo-ssh/identity`;
- optional remote Hermes path; and
- optional profile.

It does not accept a host source path, password/token, provider credential,
Orgo/Composio credential, local mode, or host-key acceptance.

## G4: independent review and gateway-token decision

An independent reviewer audits the complete C01-C13 series and actual artifact.
Record reviewer, reviewed Git SHA, artifact SHA256, review date, and zero open
Critical/High findings except the already identified transient renderer
gateway credential if it is still rated High. Carter must record exactly one:

- `ACCEPT-INCREMENTAL`: a single-user Kronos-only waiver accepting that named
  High residual after C10.4; or
- `REQUIRE-PROXY`: implement and re-review the main-process gateway proxy
  before any credential-bearing launch.

Without Carter's recorded decision, the proxy is mandatory and G5 is blocked.
This is the first point at which the real dedicated identity and verified
known-hosts file may be mounted.

## G5: staged Mini proof

Use a non-authoritative Hermes copy and distinct `HERMES_HOME`/profile. Verify
Hermes `0.20.4`, commit `c820a5d38321a8d870e5b1ed0d89f8b933dd48e8`,
and schema `26` before starting. Enter no provider, Orgo, or Composio secret in
Korgo.

Record these observations:

1. an existing staged conversation opens;
2. a new turn survives app restart;
3. default and second profiles reconnect;
4. WebCTX succeeds from Mini-local `127.0.0.1:8090` through Hermes, with no
   direct Korgo connection;
5. cron and messaging continue while the GUI is closed;
6. a host-key mismatch fails before token upload or remote start;
7. the network trace contains only loopback and the approved Mini address; and
8. closing/restarting Korgo does not stop Mini services.

Stop on any version/schema/commit mismatch, host mismatch, unexpected read or
egress, local/bootstrap/integration trace, persistence/profile failure, or
Mini-service coupling. Revoke the test key after an exposure failure.

## G6-G7: explicit live cutover and observation

G6 is manual and blocking. Approval of the implementation plan is not approval
of live cutover. Carter must approve the reviewed artifact SHA, containment
unit, host fingerprint, dedicated identity, complete G5 evidence, and G4
decision in the evidence manifest.

Before the first live connection, follow the separate Mini migration runbook,
verify one gateway owns authoritative state, keep Kronos Hermes data unchanged
for at least seven stable days, retain the existing Kronos WebCTX tunnel for
other consumers, and mount only the dedicated Korgo identity/known-hosts files.

Repeat the G5 matrix against live Mini, then observe for seven days: gateway
restart/reconnect, Mini RAM/swap/CPU, cron and messaging without the GUI,
MCP/WebCTX failures, containment/network-denial logs, and profile/session
persistence. Do not delete Kronos state, tunnel, backups, or Mini evidence in
this period.

## Evidence

Validate the redacted JSON manifest against
[`apps/desktop/e2e/evidence/ssh-only-evidence-schema.json`](../apps/desktop/e2e/evidence/ssh-only-evidence-schema.json).
Attach exact command results, test reports, process flags, bundle scan,
artifact hashes, strict-SSH argv with paths redacted, and containment matrices.
Never attach keys, tokens, candidate credential URLs, secret source paths, or
unredacted logs.

## Rollback and revocation

Client-only rollback:

1. stop and disable the Korgo system service;
2. revoke the dedicated public key on Mini and never reuse it;
3. preserve dedicated Korgo data and redacted logs for diagnosis; and
4. do not mutate or clean live Mini state from the client.

Backend rollback: stop Mini Hermes and client-owned SSH dashboard processes,
do not copy Mini state backward, restart unchanged Kronos gateway/event
services, verify version/database/gateway plus one messaging turn and WebCTX
through the existing tunnel, and preserve Mini state for comparison.
