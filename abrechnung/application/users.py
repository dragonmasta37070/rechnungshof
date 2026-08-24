import logging

from asyncpg import UniqueViolationError
from asyncpg.pool import Pool
from sftkit.database import Connection
from sftkit.error import InvalidArgument, Unauthorized
from sftkit.service import Service, with_db_transaction

from abrechnung.config import Config
from abrechnung.domain.users import User

logger = logging.getLogger(__name__)


class UserService(Service[Config]):
    def __init__(
        self,
        db_pool: Pool,
        config: Config,
    ):
        super().__init__(db_pool=db_pool, config=config)

    @staticmethod
    async def _get_user(conn: Connection, user_id: int) -> User:
        user = await conn.fetch_one(
            User,
            "select id, email, registered_at, username, pending, deleted, is_guest_user, oidc_subject "
            "from usr where id = $1",
            user_id,
        )

        if user is None:
            raise InvalidArgument(f"User with id {user_id} does not exist")

        return user

    @with_db_transaction
    async def get_user(self, *, conn: Connection, user_id: int) -> User:
        return await self._get_user(conn, user_id)

    @with_db_transaction
    async def get_or_provision_user(self, *, conn: Connection, claims: dict) -> User:
        """Resolve the local user for a validated OIDC token, creating it on first sight.

        The 'sub' claim is the identity. It is stable for a given user and client,
        and providers do not reuse it, which is what makes it safe as a primary
        key. Email and username are display information only and are refreshed
        from the token on every request, so a rename in the provider propagates
        without any sync job.
        """
        subject = claims.get("sub")
        if not subject:
            raise Unauthorized("access token is missing the sub claim")

        email = claims.get("email")
        if not email:
            # The provider is not releasing the email scope. This is a deployment
            # problem, not a user problem, so say so plainly in the log.
            logger.warning("access token for subject %s carries no email claim", subject)
            raise Unauthorized("access token is missing the email claim")

        user_id = await conn.fetchval("select id from usr where oidc_subject = $1", subject)
        if user_id is not None:
            # Keep the local copy in step with the provider.
            await conn.execute("update usr set email = $2 where id = $1", user_id, email)
            return await self._get_user(conn, user_id)

        username = claims.get("preferred_username") or claims.get("name") or email.split("@")[0]
        return await self._provision_user(conn=conn, subject=subject, email=email, username=username)

    async def _provision_user(self, *, conn: Connection, subject: str, email: str, username: str) -> User:
        # Deliberately no linking of an existing account by email address. Matching
        # on an email claim is how OIDC integrations get turned into account
        # takeover: anyone who can get a token carrying a victim's email address
        # inherits their account. Linking a pre-existing local account is an
        # operator decision, made by setting oidc_subject by hand.
        for attempt in range(5):
            candidate = username if attempt == 0 else f"{username}-{subject[:8]}-{attempt}"
            try:
                # A savepoint, not just a try/except. In postgres a failed statement
                # poisons the entire surrounding transaction, so without this the
                # retry below would only ever raise InFailedSQLTransactionError.
                async with conn.transaction():
                    user_id = await conn.fetchval(
                        "insert into usr (username, email, oidc_subject, hashed_password, pending) "
                        "values ($1, $2, $3, null, false) returning id",
                        candidate,
                        email,
                        subject,
                    )
                logger.info("provisioned user %s for oidc subject %s", candidate, subject)
                return await self._get_user(conn, user_id)
            except UniqueViolationError as e:
                if e.constraint_name == "usr_username_key":
                    # Display names are cosmetic, so a clash is worth working around
                    # rather than locking the user out.
                    continue
                if e.constraint_name == "usr_email_key":
                    logger.error(
                        "cannot provision oidc subject %s: email %s already belongs to another account",
                        subject,
                        email,
                    )
                    raise Unauthorized("an account with this email address already exists") from e
                raise

        raise Unauthorized("could not allocate a username for this account")
