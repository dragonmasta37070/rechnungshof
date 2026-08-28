from fastapi import APIRouter, Depends
from pydantic import BaseModel

from abrechnung import MAJOR_VERSION, MINOR_VERSION, PATCH_VERSION, __version__
from abrechnung.config import Config, ServiceMessage
from abrechnung.http.dependencies import get_config

router = APIRouter(
    prefix="/api",
    tags=["common"],
)


class VersionResponse(BaseModel):
    version: str
    major_version: int
    minor_version: int
    patch_version: int

    class Config:
        json_schema_extra = {
            "example": {
                "version": "1.3.2",
                "major_version": 1,
                "minor_version": 3,
                "patch_version": 2,
            }
        }


@router.get("/version", response_model=VersionResponse, operation_id="get_version")
async def get_version():
    return {
        "version": __version__,
        "major_version": MAJOR_VERSION,
        "minor_version": MINOR_VERSION,
        "patch_version": PATCH_VERSION,
    }


class OIDCFrontendConfig(BaseModel):
    """What a browser client needs to start the PKCE flow itself.

    Both values are public by definition: the client id travels in every
    authorization URL, and the issuer is the provider's own discovery identity.
    Nothing secret is exposed here — the audience/client id is not a credential,
    which is exactly why the provider is configured as a public client.

    Serving these instead of baking them into the bundle is what keeps one built
    artifact deployable against dev, staging and production: an Angular build is
    static, so container env vars never reach the browser on their own.
    """

    issuer: str
    client_id: str


class FrontendConfig(BaseModel):
    messages: list[ServiceMessage] | None = None
    imprint_url: str | None = None
    source_code_url: str
    issue_tracker_url: str
    oidc: OIDCFrontendConfig


@router.get("/config", response_model=FrontendConfig, operation_id="get_config")
async def get_frontend_config(config: Config = Depends(get_config)):
    cfg = FrontendConfig(
        messages=config.service.messages,
        imprint_url=config.service.imprint_url,
        source_code_url=config.service.source_code_url,
        issue_tracker_url=config.service.issue_tracker_url,
        # The audience the backend validates against is the same client id the
        # browser authenticates with — one value, one env var, no way to drift.
        oidc=OIDCFrontendConfig(
            issuer=config.oidc.issuer,
            client_id=config.oidc.audience,
        ),
    )
    return cfg
