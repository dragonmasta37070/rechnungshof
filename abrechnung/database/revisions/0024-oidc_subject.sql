-- migration: c496e6f5
-- requires: b59de5c4

-- Authentik becomes the sole identity provider. Users are keyed by the OIDC
-- 'sub' claim, which is stable per user per client and never reused.
alter table usr add column oidc_subject text;

-- Unique implies an index in postgres, so this covers both requirements.
-- Nullable on purpose: multiple nulls are allowed by a unique constraint, so
-- users predating the OIDC switch stay valid until they are linked or removed.
alter table usr add constraint usr_oidc_subject_key unique (oidc_subject);

-- No password is ever set again. The column stays for now so that this
-- migration is reversible and existing rows keep their data; dropping it is a
-- separate cleanup once no code references it.
alter table usr alter column hashed_password drop not null;
