"""Focused tests for EvoLink provider wiring."""

from __future__ import annotations

import pytest

from hermes_cli.auth import (
    PROVIDER_REGISTRY,
    get_api_key_provider_status,
    resolve_api_key_provider_credentials,
    resolve_provider,
)
from hermes_cli.models import _PROVIDER_LABELS, normalize_provider, provider_model_ids
from providers import get_provider_profile


@pytest.fixture(autouse=True)
def _clear_evolink_env(monkeypatch):
    monkeypatch.delenv("EVOLINK_API_KEY", raising=False)
    monkeypatch.delenv("EVOLINK_BASE_URL", raising=False)


class TestEvoLinkProvider:
    def test_profile_registered(self):
        profile = get_provider_profile("evolink")
        assert profile is not None
        assert profile.display_name == "EvoLink"
        assert profile.env_vars == ("EVOLINK_API_KEY", "EVOLINK_BASE_URL")
        assert profile.base_url == "https://api.evolink.ai/v1"

    def test_auth_registry_auto_registered(self):
        pconfig = PROVIDER_REGISTRY["evolink"]
        assert pconfig.name == "EvoLink"
        assert pconfig.auth_type == "api_key"
        assert pconfig.api_key_env_vars == ("EVOLINK_API_KEY",)
        assert pconfig.base_url_env_var == "EVOLINK_BASE_URL"
        assert pconfig.inference_base_url == "https://api.evolink.ai/v1"

    @pytest.mark.parametrize("alias", ["evolink", "evolink-ai", "evolinkai"])
    def test_alias_resolves(self, alias, monkeypatch):
        monkeypatch.setenv("EVOLINK_API_KEY", "evolink-test-key")
        assert resolve_provider(alias) == "evolink"
        assert normalize_provider(alias) == "evolink"

    def test_credentials_default_base_url(self, monkeypatch):
        monkeypatch.setenv("EVOLINK_API_KEY", "evolink-test-key")
        creds = resolve_api_key_provider_credentials("evolink")
        assert creds["provider"] == "evolink"
        assert creds["api_key"] == "evolink-test-key"
        assert creds["base_url"] == "https://api.evolink.ai/v1"

    def test_credentials_base_url_override(self, monkeypatch):
        monkeypatch.setenv("EVOLINK_API_KEY", "evolink-test-key")
        monkeypatch.setenv("EVOLINK_BASE_URL", "https://direct.evolink.ai/v1")
        creds = resolve_api_key_provider_credentials("evolink")
        assert creds["base_url"] == "https://direct.evolink.ai/v1"

    def test_status_configured(self, monkeypatch):
        monkeypatch.setenv("EVOLINK_API_KEY", "evolink-test-key")
        assert get_api_key_provider_status("evolink")["configured"]

    def test_model_picker_fallback(self):
        assert _PROVIDER_LABELS["evolink"] == "EvoLink"
        assert provider_model_ids("evolink")[:2] == ["evolink/auto", "gpt-5.5"]

    def test_providers_overlay(self):
        from hermes_cli.providers import get_provider

        provider = get_provider("evolink")
        assert provider is not None
        assert provider.name == "EvoLink"
        assert provider.api_key_env_vars == ("EVOLINK_API_KEY",)
        assert provider.base_url == "https://api.evolink.ai/v1"
        assert provider.base_url_env_var == "EVOLINK_BASE_URL"
