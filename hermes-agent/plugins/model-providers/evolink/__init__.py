"""EvoLink provider profile."""

from providers import register_provider
from providers.base import ProviderProfile


evolink = ProviderProfile(
    name="evolink",
    aliases=("evolink-ai", "evolinkai"),
    display_name="EvoLink",
    description="EvoLink OpenAI-compatible model gateway",
    signup_url="https://evolink.ai/",
    env_vars=("EVOLINK_API_KEY", "EVOLINK_BASE_URL"),
    base_url="https://api.evolink.ai/v1",
    auth_type="api_key",
    default_aux_model="gpt-5.1",
    fallback_models=(
        "evolink/auto",
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.2",
        "gpt-5.1",
    ),
)

register_provider(evolink)
