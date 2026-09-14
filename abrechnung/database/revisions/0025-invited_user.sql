-- migration: 7a1c9f04
-- requires: c496e6f5

-- An invite can now name the person it is for. That invite is only usable by
-- them, and until they accept it, it shows as pending on both sides.
-- Null keeps the old behaviour: a link anybody may follow.
alter table group_invite add column invited_user_id int references usr (id) on delete cascade;
