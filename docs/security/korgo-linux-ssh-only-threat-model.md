# Korgo Linux SSH-only threat model

## Scope and trust boundaries

Korgo on Kronos is a display client for an existing Hermes gateway on Mini.
Mini owns Hermes configuration, credentials, profiles, cron, messaging, MCPs,
and WebCTX. Korgo owns only its local connection record, UI state, cache, and
the lifecycle of its SSH tunnel. Closing Korgo must not stop any Mini service.

The security boundaries are:

1. Kronos host to the packaged Electron process;
2. Bubblewrap filesystem/environment/IPC isolation;
3. the system service's cgroup network filter;
4. strict SSH server identity and a dedicated client key;
5. Electron main/preload/renderer privilege separation; and
6. Mini's persistent Hermes/WebCTX/integration ownership.

The client is single-user. This model does not approve multi-user distribution,
less-trusted plugins/content, or a generic remote-desktop SKU.

## Assets and invariants

- The dedicated private key and verified `known_hosts` file appear only at
  `/run/korgo-ssh/identity` and `/run/korgo-ssh/known_hosts`, read-only.
- Normal home data, `.ssh`, `.hermes`, credential stores, project trees, and
  SSH-agent sockets are not mounted. `HOME` is synthetic and
  `SSH_AUTH_SOCK` is absent.
- Neither the session nor system D-Bus socket is mounted, and
  `DBUS_SESSION_BUS_ADDRESS` is absent. Same-user Secret Service, portals, and
  the user systemd manager are outside the client boundary.
- The packaged renderer loads from the secure `korgo-app://bundle` origin, whose
  protocol handler serves only real files below the immutable renderer bundle.
  Its CSP has no loopback connection source, and the SSH SKU contains no
  arbitrary file-read, attachment-read, Git, or terminal renderer IPC surface.
- A dummy-input packaged smoke must prove that both fetch and XHR reject
  `file:///run/korgo-ssh/identity`; a source-only protocol test is insufficient.
- Egress is denied except loopback and one numeric Mini Tailscale `/32` or
  `/128`. Hostnames and DNS are unnecessary.
- Host trust is pre-seeded. `ssh-keyscan` can collect a candidate key but
  cannot establish trust; its fingerprint must be verified out-of-band.
- The packaged runtime is Electron 43.4.1 from reviewed fixed-output inputs.
  Source/dev launches, FUSE AppImage execution, `--no-sandbox`, and unlocked
  downloads are outside this boundary.
- Mini remains authoritative for Hermes state and integrations. The client
  neither stores their secrets nor runs a local fallback.

## Threats and dispositions

| ID | Threat | Disposition and required evidence |
| --- | --- | --- |
| T01 | Mini SSH spoofing | Mitigate with an out-of-band verified, pre-seeded key and a mismatch-before-auth test. TOFU is forbidden. |
| T02 | Identity/known-host tampering | Mitigate with exact read-only binds plus regular-file, owner, mode, manifest, and fingerprint checks in the same `ExecStart` mount namespace that launches the client. |
| T03 | Unreviewed cutover | Mitigate with reviewed Git/artifact hashes plus explicit G4 and G6 records in the non-secret evidence manifest. |
| T04 | Transient gateway credential in renderer | Remains a High residual only if Carter records `ACCEPT-INCREMENTAL` at G4 for this topology. Otherwise the main-process proxy is mandatory before credentials. |
| T05 | Host secret disclosure | Mitigate with exact bwrap mounts, a cleared environment, synthetic home, no agent, compile-time removal of arbitrary renderer file/Git/terminal IPC, and a packaged dummy-identity fetch/XHR denial test. |
| T06 | Retry/bootstrap denial of service | Bound reconnect/restart attempts and fail closed; never fall back to local install/bootstrap. |
| T07 | Renderer/guest privilege escalation | Require registered top-level IPC authorization, a bundle-confined secure custom origin, isolated untrusted content, narrowed CSP, no production CDP, and packaged malicious-context evidence. |
| T08 | Orgo/Composio/unlocked installer execution | Eliminate from this compile-time SKU and require a zero-finding bundle scan. |
| T09 | Link-driven SSRF | Eliminate automatic title-fetch requests and prove zero request from rendered assistant links. |
| T10 | Chromium sandbox bypass | Keep Chromium sandboxing active; reject `--no-sandbox`, sandbox fallback, setuid/FUSE workarounds, and production CDP. The dummy-identity smoke may open one ephemeral loopback CDP endpoint inside its isolated test sandbox and must terminate it on exit. |
| T11 | Preview/webview escape | Enforce preferences in main, deny guest IPC/media, and use no persistent guest partition. |
| T12 | Media permission disclosure | Admit only the registered trusted top-level origin and exact media type; deny guests. |
| T13 | Unexpected network egress | Use a system service so the system manager owns `IPAddressDeny=any`; prove actual unit properties and the G3/G5/G7 network matrices. |
| T14 | Authoritative Hermes state damage | Stage against a non-authoritative copy, require one gateway owner, pin version/commit/schema, and never copy state backward automatically. |

## Renderer-token decision

Containment does not make a renderer-visible, token-bearing WebSocket URL
harmless. It narrows where a compromised renderer can send the token, but the
renderer could still act as the user against the loopback-forwarded gateway.
The evidence manifest therefore requires one G4 decision:

- `ACCEPT-INCREMENTAL`: Carter accepts this named High residual for the
  single-user contained Kronos topology after independent review confirms all
  other C01-C13 controls, including transient-only handling; or
- `REQUIRE-PROXY`: the main process owns the authenticated WebSocket and C14 is
  implemented and re-reviewed before a credential-bearing run.

The residual must not be relabeled as remediated. A proxy is mandatory before
multi-user distribution, less-trusted content/plugins, or when the waiver is
not recorded.

## Fail-closed conditions

Stop before launch on a missing/mismatched host key, wrong Hermes
version/commit/schema, missing package evidence, ignored IP controls, readable
host marker, inherited agent socket, visible session/system D-Bus transport,
unexpected egress, local/bootstrap trace, disabled Chromium sandbox, open
production CDP, untrusted IPC side effect, or a secret in logs/evidence/Git.
The isolated dummy-input smoke described under T10 is the sole CDP exception.
Revoke the dedicated key if it was ever mounted during a failed staged/live
test.
