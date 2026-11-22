-- RIFT ARENA — MySQL schema (Alwaysdata / any MySQL 5.7+ / MariaDB 10.3+)
-- Conventions: utf8mb4, InnoDB, ids as CHAR(36) UUIDs, created_at/updated_at everywhere.
-- Note: auth+profile+wallet+stats are merged in `users` (single-row hot path);
--       document-like content (events, news, shop, maps, passes) uses JSON columns.

CREATE TABLE IF NOT EXISTS users (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  username         VARCHAR(16)  NOT NULL,
  username_lower   VARCHAR(16)  NOT NULL UNIQUE,
  pass_hash        VARCHAR(255) NOT NULL,            -- scrypt$salt$hash (never plaintext)
  role             ENUM('player','HELPER','MODERATOR','ADMIN') NOT NULL DEFAULT 'player',
  trophies         INT          NOT NULL DEFAULT 0,
  xp               INT          NOT NULL DEFAULT 0,
  level            INT          NOT NULL DEFAULT 1,
  avatar           VARCHAR(40)  NOT NULL DEFAULT 'avatar_ion',
  banner           VARCHAR(40)  NOT NULL DEFAULT 'banner_ion',
  title            VARCHAR(40)  NOT NULL DEFAULT '',
  credits          INT          NOT NULL DEFAULT 0,
  rift_tokens      INT          NOT NULL DEFAULT 0,
  pass_xp          INT          NOT NULL DEFAULT 0,
  matches          INT          NOT NULL DEFAULT 0,
  wins             INT          NOT NULL DEFAULT 0,
  losses           INT          NOT NULL DEFAULT 0,
  kills            INT          NOT NULL DEFAULT 0,
  playtime_s       INT          NOT NULL DEFAULT 0,
  banned_until     DATETIME     NULL,
  ban_reason       VARCHAR(120) NULL,
  muted_until      DATETIME     NULL,
  privacy          ENUM('public','private') NOT NULL DEFAULT 'public',
  favorite_fighter VARCHAR(24)  NULL,
  selected_fighter VARCHAR(24)  NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen        DATETIME     NULL,
  INDEX idx_users_trophies (trophies DESC),
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64)  NOT NULL PRIMARY KEY,     -- sha256 of token; raw token never stored
  user_id    CHAR(36)  NOT NULL,
  expires_at DATETIME  NOT NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS trophies_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    CHAR(36) NOT NULL,
  amount     INT      NOT NULL,
  reason     VARCHAR(60) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tlog_user (user_id, created_at),
  CONSTRAINT fk_tlog_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_brawlers (
  user_id    CHAR(36) NOT NULL,
  fighter_id VARCHAR(24) NOT NULL,
  unlocked   TINYINT(1) NOT NULL DEFAULT 0,
  trophies   INT NOT NULL DEFAULT 0,
  xp         INT NOT NULL DEFAULT 0,
  level      INT NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, fighter_id),
  CONSTRAINT fk_brawlers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_inventory (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     CHAR(36) NOT NULL,
  kind        ENUM('skin','banner','avatar','title','effect','emote','chest','road') NOT NULL,
  ref_id      VARCHAR(60) NOT NULL,
  qty         INT NOT NULL DEFAULT 1,
  acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inv (user_id, kind, ref_id),
  CONSTRAINT fk_inv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_missions (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    CHAR(36) NOT NULL,
  period_key VARCHAR(20) NOT NULL,                 -- '2026-11-22' | '2026-W47' | 'S1'
  tpl_id     VARCHAR(40) NOT NULL,
  progress   INT NOT NULL DEFAULT 0,
  claimed    TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mission (user_id, period_key, tpl_id),
  CONSTRAINT fk_missions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS friends (
  user_a     CHAR(36) NOT NULL,                     -- always user_a < user_b
  user_b     CHAR(36) NOT NULL,
  blocked_by CHAR(36) NULL,
  since      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_a, user_b),
  INDEX idx_friends_a (user_a), INDEX idx_friends_b (user_b)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS friend_requests (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  from_user CHAR(36) NOT NULL,
  to_user   CHAR(36) NOT NULL,
  at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_freq (from_user, to_user),
  INDEX idx_freq_to (to_user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS clans (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(20)  NOT NULL,
  tag        VARCHAR(5)   NOT NULL UNIQUE,
  descr      VARCHAR(120) NOT NULL DEFAULT '',
  logo       VARCHAR(20)  NOT NULL DEFAULT 'rift',
  banner     VARCHAR(40)  NOT NULL DEFAULT 'banner_rift',
  level      INT          NOT NULL DEFAULT 1,
  xp         INT          NOT NULL DEFAULT 0,
  trophies   INT          NOT NULL DEFAULT 0,
  open       TINYINT(1)   NOT NULL DEFAULT 1,
  leader_id  CHAR(36)     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_clans_trophies (trophies DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS clan_members (
  user_id   CHAR(36) NOT NULL PRIMARY KEY,
  clan_id   CHAR(36) NOT NULL,
  role      ENUM('leader','coleader','officer','member','recruit') NOT NULL DEFAULT 'member',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_clanm_clan (clan_id),
  CONSTRAINT fk_clanm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_clanm_clan FOREIGN KEY (clan_id) REFERENCES clans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS clan_requests (
  id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  clan_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_creq (clan_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- weekly clan war aggregate (one row per clan per week)
CREATE TABLE IF NOT EXISTS clan_wars (
  week    CHAR(10)    NOT NULL,                     -- '2026-W47'
  clan_id CHAR(36)    NOT NULL,
  matches INT NOT NULL DEFAULT 0,
  wins    INT NOT NULL DEFAULT 0,
  points  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (week, clan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  channel    ENUM('global','clan','party','private') NOT NULL,
  channel_id VARCHAR(64) NOT NULL DEFAULT '',
  user_id    CHAR(36) NOT NULL,
  username   VARCHAR(16) NOT NULL,
  text       VARCHAR(240) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_msg_chan (channel, channel_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS game_matches (
  id          VARCHAR(40) NOT NULL PRIMARY KEY,
  mode        VARCHAR(24) NOT NULL,
  map         VARCHAR(40) NOT NULL,
  ranked      TINYINT(1) NOT NULL DEFAULT 0,
  winner_team VARCHAR(12) NULL,
  duration_ms INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_matches_mode (mode, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS match_players (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id       VARCHAR(40) NOT NULL,
  user_id        CHAR(36) NOT NULL,
  username       VARCHAR(16) NOT NULL,
  mode           VARCHAR(24) NOT NULL,
  team           VARCHAR(12) NOT NULL,
  fighter        VARCHAR(24) NOT NULL,
  kills          INT NOT NULL DEFAULT 0,
  deaths         INT NOT NULL DEFAULT 0,
  damage         INT NOT NULL DEFAULT 0,
  objectives     INT NOT NULL DEFAULT 0,
  won            TINYINT(1) NOT NULL DEFAULT 0,
  trophies_delta INT NOT NULL DEFAULT 0,
  star_player    TINYINT(1) NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mp_user (user_id, created_at),
  INDEX idx_mp_match (match_id),
  CONSTRAINT fk_mp_match FOREIGN KEY (match_id) REFERENCES game_matches(id) ON DELETE CASCADE,
  CONSTRAINT fk_mp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ranked_seasons (
  id         CHAR(36) NOT NULL PRIMARY KEY,
  name       VARCHAR(60) NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at    DATETIME NULL,
  ended_at   DATETIME NULL,
  reset_to   VARCHAR(12) NOT NULL DEFAULT 'gold'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ranked_players (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  season_id  CHAR(36) NOT NULL,
  user_id    CHAR(36) NOT NULL,
  rp         INT NOT NULL DEFAULT 0,
  wins       INT NOT NULL DEFAULT 0,
  losses     INT NOT NULL DEFAULT 0,
  streak     INT NOT NULL DEFAULT 0,
  peak       INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ranked (season_id, user_id),
  INDEX idx_ranked_rp (season_id, rp DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS events (
  id       CHAR(36)    NOT NULL PRIMARY KEY,
  data     JSON        NOT NULL,                    -- full validated event document
  priority INT         NOT NULL DEFAULT 0,
  status   VARCHAR(12) NOT NULL DEFAULT 'draft',
  INDEX idx_events_status (status, priority DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS event_progress (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id   CHAR(36) NOT NULL,
  user_id    CHAR(36) NOT NULL,
  progress   INT NOT NULL DEFAULT 0,
  claimed    TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_eprog (event_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS battle_passes (
  id   CHAR(36) NOT NULL PRIMARY KEY,
  data JSON     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS battle_pass_progress (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pass_id         CHAR(36) NOT NULL,
  user_id         CHAR(36) NOT NULL,
  xp              INT NOT NULL DEFAULT 0,
  tier            INT NOT NULL DEFAULT 0,
  premium         TINYINT(1) NOT NULL DEFAULT 0,
  claimed_free    JSON NOT NULL,
  claimed_premium JSON NOT NULL,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bpp (pass_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS news (
  id        CHAR(36)    NOT NULL PRIMARY KEY,
  data      JSON        NOT NULL,
  published TINYINT(1)  NOT NULL DEFAULT 0,
  priority  INT         NOT NULL DEFAULT 0,
  date      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_news_pub (published, priority DESC, date DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shop_items (
  id   CHAR(36) NOT NULL PRIMARY KEY,
  data JSON     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shop_rotations (
  day_key  DATE NOT NULL PRIMARY KEY,
  item_ids JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reports (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  data       JSON        NOT NULL,
  status     VARCHAR(10) NOT NULL DEFAULT 'open',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reports_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sanctions (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL,
  type       ENUM('ban','mute') NOT NULL,
  reason     VARCHAR(120) NOT NULL DEFAULT '',
  by_id      CHAR(36)     NULL,
  until      DATETIME     NULL,                     -- NULL = permanent
  status     ENUM('active','revoked','expired') NOT NULL DEFAULT 'active',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sanctions_user (user_id, status),
  CONSTRAINT fk_sanctions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_logs (
  id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  author  VARCHAR(16)  NOT NULL,
  role    VARCHAR(12)  NOT NULL,
  action  VARCHAR(40)  NOT NULL,
  target  VARCHAR(60)  NOT NULL DEFAULT '',
  details JSON         NULL,
  result  VARCHAR(20)  NOT NULL DEFAULT 'ok',
  at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_alogs_at (at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS game_config (
  k VARCHAR(40) NOT NULL PRIMARY KEY,
  v JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS maps (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  author_id  CHAR(36)     NULL,
  author_name VARCHAR(16) NOT NULL DEFAULT '',
  status     ENUM('draft','pending','published','rejected') NOT NULL DEFAULT 'draft',
  likes      INT NOT NULL DEFAULT 0,
  plays      INT NOT NULL DEFAULT 0,
  featured   TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  data       JSON NOT NULL,                          -- full map document (grid, spawns, modes...)
  INDEX idx_maps_status (status, created_at),
  INDEX idx_maps_author (author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS parties (
  id         CHAR(36) NOT NULL PRIMARY KEY,
  leader_id  CHAR(36) NULL,
  mode       VARCHAR(24) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS party_members (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  party_id  CHAR(36) NOT NULL,
  user_id   CHAR(36) NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pm (party_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
