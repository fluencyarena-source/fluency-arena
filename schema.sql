-- ─────────────────────────────────────────────────────────
--  FLUENCY ARENA — Supabase Database Schema
--  Paste this entire file into Supabase SQL Editor and Run
-- ─────────────────────────────────────────────────────────

-- USERS
create table if not exists users (
  id                     text primary key,
  first_name             text not null,
  last_name              text not null,
  email                  text unique not null,
  mobile                 text,
  password_hash          text,
  role                   text default 'student' check (role in ('student','teacher','administrator')),
  plan                   text default 'free'    check (plan in ('free','pro','champion')),
  plan_expiry            timestamptz,
  dob                    date,
  stream                 text,
  bio                    text,
  preparing              jsonb default '[]',
  privacy                text default 'public',
  notification_prefs     jsonb default '{}',
  profile_complete       boolean default false,
  google_id              text,
  deletion_scheduled_at  timestamptz,
  last_login             timestamptz,
  created_at             timestamptz default now()
);

-- Index for fast email lookups
create index if not exists users_email_idx on users(email);
create index if not exists users_mobile_idx on users(mobile);
create index if not exists users_role_idx on users(role);
create index if not exists users_plan_idx on users(plan);

-- PROGRESS (one row per user)
create table if not exists progress (
  id              bigserial primary key,
  user_id         text unique references users(id) on delete cascade,
  xp              int default 0,
  words           int default 0,
  streak          int default 0,
  done_vocab      jsonb default '[]',
  done_wotd       jsonb default '[]',
  done_speaking   jsonb default '[]',
  speaking_scores jsonb default '[]',
  updated_at      timestamptz default now()
);

-- REVIEWS
create table if not exists reviews (
  id         bigserial primary key,
  user_id    text references users(id) on delete set null,
  name       text not null,
  role_label text,
  rating     int check (rating between 1 and 5),
  review     text not null,
  created_at timestamptz default now()
);

-- PAYMENTS
create table if not exists payments (
  id                   bigserial primary key,
  user_id              text references users(id) on delete set null,
  razorpay_payment_id  text,
  razorpay_order_id    text,
  plan                 text,
  amount               int,
  status               text default 'captured',
  created_at           timestamptz default now()
);

-- ANNOUNCEMENTS
create table if not exists announcements (
  id         text primary key,
  title      text not null,
  body       text,
  type       text default 'info',
  created_by text references users(id) on delete set null,
  created_at timestamptz default now()
);

-- FEEDBACK
create table if not exists feedback (
  id         bigserial primary key,
  user_id    text references users(id) on delete set null,
  email      text,
  type       text default 'feedback',
  message    text not null,
  created_at timestamptz default now()
);

-- SIGNUP LOGS
create table if not exists signup_logs (
  id         bigserial primary key,
  user_id    text,
  email      text,
  name       text,
  mobile     text,
  created_at timestamptz default now()
);

-- ADMIN LOGS
create table if not exists admin_logs (
  id         bigserial primary key,
  message    text,
  admin_id   text references users(id) on delete set null,
  created_at timestamptz default now()
);

-- OTP STORE (temporary — expires in 10 min)
create table if not exists otp_store (
  mobile      text primary key,
  otp         text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz default now()
);

-- DEBATE POLLS
create table if not exists debate_polls (
  id         text primary key,
  question   text not null,
  options    jsonb default '[]',
  votes      jsonb default '{}',
  status     text default 'open',
  closes_at  timestamptz,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
--  SEED: Admin account
--  Password: Admin@123
--  bcrypt hash of Admin@123 (cost 10)
-- ─────────────────────────────────────────────
insert into users (
  id, first_name, last_name, email, password_hash,
  role, plan, profile_complete, dob, stream,
  preparing, created_at
) values (
  'admin_001',
  'Admin',
  'FA',
  'admin@fluencyarena.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  'administrator',
  'free',
  true,
  '1990-01-01',
  'Other',
  '["Communication improvement"]',
  now()
)
on conflict (id) do nothing;

-- Seed progress row for admin
insert into progress (user_id) values ('admin_001')
on conflict (user_id) do nothing;
