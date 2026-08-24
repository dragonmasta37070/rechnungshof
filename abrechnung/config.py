import enum
from datetime import timedelta
from pathlib import Path
from typing import List, Tuple, Type

import yaml
from pydantic import BaseModel
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)
from sftkit.database import DatabaseConfig
from sftkit.http import HTTPServerConfig


class ServiceMessageType(enum.Enum):
    info = "info"
    error = "error"
    warning = "warning"
    success = "success"


class ServiceMessage(BaseModel):
    type: ServiceMessageType
    title: str | None = None
    body: str


class ServiceConfig(BaseModel):
    name: str

    messages: list[ServiceMessage] | None = None
    imprint_url: str | None = None
    source_code_url: str = "https://github.com/SFTtech/abrechnung"
    issue_tracker_url: str = "https://github.com/SFTtech/abrechnung/issues"


class DemoConfig(BaseModel):
    enabled: bool = False
    wipe_interval: timedelta = timedelta(hours=1)


class ApiConfig(HTTPServerConfig):
    secret_key: str
    id: str = "default"
    max_uploadable_file_size: int = 1024
    enable_cors: bool = True


class OIDCConfig(BaseModel):
    """Authentik (or any OIDC provider) is the sole identity provider.

    The backend is a pure resource server: it never performs an OAuth handshake
    and never sees a credential. It only validates access tokens that the client
    obtained itself via the authorization code flow with PKCE.
    """

    issuer: str
    audience: str
    jwks_url: str

    # Only asymmetric algorithms. Allowing an HMAC algorithm here would let an
    # attacker sign a token with the public JWKS key and have it accepted.
    algorithms: List[str] = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"]

    # How long a fetched JWKS is reused before it is refetched. An unknown key id
    # forces an immediate refetch regardless, so provider key rotation is picked
    # up without waiting for this to expire.
    jwks_cache_seconds: int = 3600


class MetricsConfig(BaseModel):
    enabled: bool = False
    expose_money_amounts: bool = False


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ABRECHNUNG_", env_nested_delimiter="__")

    service: ServiceConfig
    api: ApiConfig
    database: DatabaseConfig
    oidc: OIDCConfig
    # in case all params are optional this is needed to make the whole section optional
    demo: DemoConfig = DemoConfig()
    metrics: MetricsConfig = MetricsConfig()

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: Type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> Tuple[PydanticBaseSettingsSource, ...]:
        return env_settings, init_settings, dotenv_settings, file_secret_settings


def read_config(config_path: Path) -> Config:
    content = config_path.read_text("utf-8")
    loaded = yaml.safe_load(content)
    config = Config(**loaded)
    return config
