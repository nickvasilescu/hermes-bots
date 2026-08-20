"""Fail-closed config.set targeting for stale or fabricated runtime ids."""

from unittest.mock import patch

import pytest

import tui_gateway.server as server


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("model", "model --provider provider --session"),
        ("fast", "fast"),
        ("reasoning", "high"),
    ],
)
def test_unknown_target_session_never_falls_through_to_global_config(key, value):
    handler = server._methods["config.set"]

    with (
        patch.dict(server._sessions, {}, clear=True),
        patch.object(server, "_write_config_key") as write_key,
        patch.object(server, "_apply_model_switch") as apply_model,
    ):
        response = handler(
            "rid-1",
            {"key": key, "session_id": "fabricated-runtime", "value": value},
        )

    assert response["error"]["code"] == 4001
    assert response["error"]["message"] == "session not found"
    write_key.assert_not_called()
    apply_model.assert_not_called()
