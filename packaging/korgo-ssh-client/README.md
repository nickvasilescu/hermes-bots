# Korgo SSH-only Nix packaging

This directory contains the runtime boundary used by
[`nix/korgo-ssh-client.nix`](../../nix/korgo-ssh-client.nix) and
[`nix/korgo-ssh-client-module.nix`](../../nix/korgo-ssh-client-module.nix).

- `korgo-ssh-client-bwrap` admits only the immutable Nix store, dedicated app
  data/cache, the fixed read-only identity and known-hosts files, and exact
  Wayland/audio sockets. It admits no session or system D-Bus transport, clears
  the environment, and does not bind a home directory, `.ssh`, `.hermes`,
  project tree, SSH agent, or whole runtime directory. It also refuses to run
  outside the exact system-service cgroup, so launching the package binary
  directly cannot bypass destination-IP controls.
- `korgo-ssh-client-containment-probe` is a dummy-only filesystem,
  environment, and network assertion tool. The launcher accepts the fixed
  `--containment-probe` switch; it never accepts an arbitrary command.
- `korgo-ssh-client-no-dbus-smoke` starts the built Electron artifact inside a
  separate Xvfb/bubblewrap test sandbox, requires it to stay alive without any
  session D-Bus transport, and verifies that the packaged `korgo-app:` renderer
  rejects both fetch and XHR reads of a dummy identity mounted at the production
  path. Its ephemeral CDP endpoint exists only inside this dummy-input test; the
  production artifact and launcher must contain no remote-debugging marker. It
  is a build-time test, not an installed launcher mode.
- `korgo-ssh-client.service` is a fail-closed syntax/reference policy. It has an
  inert `ExecStart` and no Mini allow rule. The NixOS module generates the
  operational system service only after the reviewed user, UID, secret source
  files, manifest, package, and numeric Mini address are supplied.

Do not copy the reference unit into `/etc/systemd/system`. Follow
[`docs/korgo-linux-ssh-only.md`](../../docs/korgo-linux-ssh-only.md), review a
separate host configuration patch, and prove the dummy G3 matrix before any
real SSH input is mounted.
