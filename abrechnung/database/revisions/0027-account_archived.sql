-- migration: b7e4c2a9
-- requires: 3d5b8e21

-- Someone who left a group still carries their share of old expenses, so their
-- account cannot be deleted. Archiving takes it out of new expenses and the
-- "who are you" picker while old expenses and balances keep showing the name.
-- Not part of the account history: it is a display preference of the group,
-- not a change to anything money depends on.
alter table account add column archived bool not null default false;
