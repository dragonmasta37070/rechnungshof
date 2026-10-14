-- migration: d4e8a1b6
-- requires: c3d9e7f1

-- An invite addressed to an email address, optionally for a specific person
-- (account) of the group. The first time a login with that address signs in,
-- it joins the group already linked to that account — no token to follow, no
-- "who are you" question. Used to move existing groups over without a second
-- link in the welcome mail.
alter table group_invite add column invited_email text;
alter table group_invite add column account_id integer references account (id) on delete cascade;
create index group_invite_invited_email on group_invite (lower(invited_email)) where invited_email is not null;
