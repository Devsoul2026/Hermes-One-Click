"""Tests for /api/models/live non-chat model filtering."""

from urllib.parse import urlparse


def _patch_live_models_basics(monkeypatch, routes, profile="default"):
    import api.config as config
    import api.profiles as profiles

    routes._clear_live_models_cache()
    monkeypatch.setattr(routes, "j", lambda _handler, payload, status=200, extra_headers=None: payload)
    monkeypatch.setattr(config, "get_config", lambda: {"model": {"provider": "openai"}})
    monkeypatch.setattr(config, "_resolve_provider_alias", lambda provider: provider)
    monkeypatch.setattr(profiles, "get_active_profile_name", lambda: profile)


def test_live_models_filters_embedding_ids_from_provider(monkeypatch):
    import sys
    import types

    import api.routes as routes

    hermes_cli = types.ModuleType("hermes_cli")
    hermes_cli.__path__ = []
    models = types.ModuleType("hermes_cli.models")

    def provider_model_ids(provider):
        return ["gpt-4o", "text-embedding-3-small", "text-moderation-latest"]

    models.provider_model_ids = provider_model_ids
    monkeypatch.setitem(sys.modules, "hermes_cli", hermes_cli)
    monkeypatch.setitem(sys.modules, "hermes_cli.models", models)

    _patch_live_models_basics(monkeypatch, routes)
    parsed = urlparse("/api/models/live?provider=openai")
    out = routes._handle_live_models(object(), parsed)
    ids = [m["id"] for m in out["models"]]
    assert ids == ["gpt-4o"]


def test_live_openai_data_skips_embedding_type_rows():
    import api.routes as routes

    data = [
        {"id": "gpt-4o", "type": "model"},
        {"id": "nomic-embed", "type": "embedding"},
        {"id": "rerank-v1", "type": "rerank"},
    ]
    assert routes._live_openai_data_chat_ids(data) == ["gpt-4o"]
