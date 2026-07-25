'use strict';

const express = require('express');
const crypto = require('crypto');
const { parseMapList } = require('./status');
const audit = require('./audit');
const { downloadMap } = require('./mapdownload');
const serverControl = require('./servercontrol');

// label/hint are shown in the panel UI; every cvar here has been checked
// against a live server (`<name>` alone prints `"<name>" is "<value>"`) —
// nothing in this list is guessed. Grouped for the Settings tab layout.
// Every cvar here has been checked against a live server (`<name>` alone
// prints `"<name>" is "<value>"`) — nothing in this list is guessed.
// label/hint/group are bilingual; the frontend picks the active language.
const CVAR_WHITELIST = {
  redm_active: {
    type: 'bool', group: { en: 'Deathmatch', ru: 'Deathmatch' },
    label: { en: 'Deathmatch mode', ru: 'Режим Deathmatch' },
    hint: {
      en: 'Switches between classic round-based play and deathmatch (fast respawns, weapon menu, spawn protection). Off by default. Ready-made spawn points only exist for de_dust2/de_inferno/de_train — other maps need spawns placed in-game with the admin tool first.',
      ru: 'Переключает между классическим раундовым режимом и deathmatch (быстрый респавн, меню оружия, защита на спавне). По умолчанию выключено. Готовые точки спавна есть только для de_dust2/de_inferno/de_train — на других картах их нужно сначала расставить в игре через админ-инструмент.',
    },
  },
  mp_friendlyfire: {
    type: 'bool', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Friendly fire', ru: 'Friendly fire' },
    hint: {
      en: 'Damage from teammates. On — be careful, you can hurt your own team. Off — the public-server default.',
      ru: 'Урон от союзников по команде. Включено — осторожно, можно получить урон от своих. Выключено — стандарт для паблик-серверов.',
    },
  },
  mp_autoteambalance: {
    type: 'bool', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Auto team balance', ru: 'Автобаланс команд' },
    hint: {
      en: 'Automatically routes new players to the less-full team so squads don’t get lopsided.',
      ru: 'Автоматически направляет новых игроков в менее заполненную команду, чтобы составы не перекашивались.',
    },
  },
  mp_limitteams: {
    type: 'int', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Team size difference limit', ru: 'Разница между командами' },
    hint: {
      en: 'Maximum allowed player-count difference between teams. 0 = no limit.',
      ru: 'Максимально допустимая разница в числе игроков между командами. 0 — без ограничений.',
    },
  },
  mp_timelimit: {
    type: 'int', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Map time limit (min)', ru: 'Лимит времени карты (мин)' },
    hint: {
      en: 'Minutes before the map rotates on a timer. 0 = never rotate by time.',
      ru: 'Через сколько минут произойдёт смена карты по таймеру. 0 — не менять карту по времени.',
    },
  },
  mp_winlimit: {
    type: 'int', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Rounds to win', ru: 'Раундов до победы' },
    hint: {
      en: 'After this many round wins, one team auto-wins and the map changes. 0 = off.',
      ru: 'После скольки выигранных раундов одна команда побеждает и карта сменится. 0 — выключено.',
    },
  },
  mp_maxrounds: {
    type: 'int', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Max rounds per map', ru: 'Макс. раундов за карту' },
    hint: {
      en: 'Map changes after this many rounds regardless of score. 0 = no limit.',
      ru: 'Смена карты после этого числа раундов, независимо от счёта. 0 — без ограничения.',
    },
  },
  mp_roundtime: {
    type: 'int', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Round length (min)', ru: 'Длительность раунда (мин)' },
    hint: { en: 'How many minutes a single round lasts before time runs out.', ru: 'Сколько минут длится один раунд до истечения времени.' },
  },
  mp_freezetime: {
    type: 'int', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Freeze time (sec)', ru: 'Заморозка в начале раунда (сек)' },
    hint: {
      en: 'Time at round start when players can’t move or shoot — used for buying gear.',
      ru: 'Время в начале раунда, когда игроки не могут двигаться и стрелять — даётся на закупку.',
    },
  },
  mp_buytime: {
    type: 'float', step: '0.1', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Buy time (min)', ru: 'Время на закупку (мин)' },
    hint: { en: 'How long into the round players can still open the buy menu.', ru: 'Сколько времени с начала раунда доступно окно закупки.' },
  },
  mp_startmoney: {
    type: 'int', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Starting money', ru: 'Стартовые деньги' },
    hint: { en: 'Money each player starts a fresh match with.', ru: 'Сумма денег, с которой игрок начинает новый матч.' },
  },
  mp_chattime: {
    type: 'int', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'End-of-map chat time (sec)', ru: 'Чат между картами (сек)' },
    hint: {
      en: 'Seconds after the map ends where players can still chat before the switch.',
      ru: 'Сколько секунд после окончания карты игроки могут пообщаться в чате перед сменой карты.',
    },
  },
  mp_c4timer: {
    type: 'int', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Bomb timer (sec)', ru: 'Таймер бомбы (сек)' },
    hint: { en: 'Seconds after planting before the bomb detonates (de_ maps only).', ru: 'Через сколько секунд после установки взрывается бомба (только de_-карты).' },
  },
  mp_tkpunish: {
    type: 'bool', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Team-kill punishment', ru: 'Наказание за тимкилл' },
    hint: {
      en: 'Punish a player for killing a teammate next round (usually damage or a spawn delay).',
      ru: 'Наказывать игрока за убийство союзника в следующем раунде (обычно уроном или задержкой появления).',
    },
  },
  mp_hostagepenalty: {
    type: 'int', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Hostage-kill limit', ru: 'Лимит убийств заложников' },
    hint: {
      en: 'Player is auto-kicked after killing this many hostages (hostage maps only).',
      ru: 'После скольких убитых заложников игрок будет автоматически кикнут (только карты с заложниками).',
    },
  },
  mp_kickpercent: {
    type: 'float', step: '0.01', group: { en: 'Rounds', ru: 'Раунды' },
    label: { en: 'Vote-kick threshold', ru: 'Порог голосования за кик' },
    hint: {
      en: 'Fraction of players who must vote yes for a votekick to pass (e.g. 0.66 = two thirds).',
      ru: 'Доля игроков, которая должна проголосовать "за", чтобы голосование за кик прошло (например, 0.66 — две трети).',
    },
  },
  mp_flashlight: {
    type: 'bool', group: { en: 'Gameplay', ru: 'Геймплей' },
    label: { en: 'Flashlight', ru: 'Фонарик' },
    hint: { en: 'Allow players to turn on their flashlight (default key F).', ru: 'Разрешить игрокам включать фонарик (по умолчанию клавиша F).' },
  },
  mp_footsteps: {
    type: 'bool', group: { en: 'Gameplay', ru: 'Геймплей' },
    label: { en: 'Footstep sounds', ru: 'Звук шагов' },
    hint: {
      en: 'Whether other players’ footsteps are audible. Off = harder to track enemies by sound.',
      ru: 'Слышны ли шаги других игроков. Выключено — сложнее вычислять врагов на слух.',
    },
  },
  mp_forcecamera: {
    type: 'int', group: { en: 'Gameplay', ru: 'Геймплей' },
    label: { en: 'Dead-player camera', ru: 'Камера мёртвых' },
    hint: {
      en: '0 = any camera/player, 1 = own team only, 2 = first-person of the killed player only.',
      ru: '0 — любую камеру и любого игрока, 1 — только свою команду, 2 — только от первого лица убитого.',
    },
  },
  mp_fadetoblack: {
    type: 'bool', group: { en: 'Gameplay', ru: 'Геймплей' },
    label: { en: 'Fade to black on death', ru: 'Затемнение при смерти' },
    hint: {
      en: 'Fade the screen to black on death instead of switching to free-look spectating.',
      ru: 'Затемнять экран при смерти вместо перехода в свободный обзор за другими игроками.',
    },
  },
  allow_spectators: {
    type: 'bool', group: { en: 'Gameplay', ru: 'Геймплей' },
    label: { en: 'Allow spectators', ru: 'Разрешить наблюдателей' },
    hint: { en: 'Allow joining as a spectator without playing for a team.', ru: 'Разрешить подключаться в режиме наблюдателя, не играя за команду.' },
  },
  sv_aim: {
    type: 'bool', group: { en: 'Gameplay', ru: 'Геймплей' },
    label: { en: 'Auto-aim assist', ru: 'Автоприцел (sv_aim)' },
    hint: {
      en: 'Legacy CS auto-aim assist. Most competitive/public servers leave this off.',
      ru: 'Устаревший режим автоприцеливания из ранних версий CS. На большинстве серверов держат выключенным.',
    },
  },
  sv_voiceenable: {
    type: 'bool', group: { en: 'Voice & Network', ru: 'Голос и сеть' },
    label: { en: 'Voice chat', ru: 'Голосовой чат' },
    hint: { en: 'Enables in-game voice chat. Players hold their own voice key client-side.', ru: 'Включает голосовой чат в игре. Игрокам нужно зажать клавишу голоса на своей стороне.' },
  },
  sv_alltalk: {
    type: 'bool', group: { en: 'Voice & Network', ru: 'Голос и сеть' },
    label: { en: 'Cross-team voice', ru: 'Голос между командами' },
    hint: {
      en: 'On = voice is heard by everyone regardless of team. Off = teammates only.',
      ru: 'Включено — голос слышен всем игрокам независимо от команды. Выключено — только своей команде.',
    },
  },
  sv_timeout: {
    type: 'int', group: { en: 'Voice & Network', ru: 'Голос и сеть' },
    label: { en: 'Client timeout (sec)', ru: 'Таймаут клиента (сек)' },
    hint: { en: 'Seconds of silence from a client before the server drops them.', ru: 'Через сколько секунд молчания от клиента сервер его отключает.' },
  },
  sv_maxupdaterate: {
    type: 'int', group: { en: 'Voice & Network', ru: 'Голос и сеть' },
    label: { en: 'Max update rate', ru: 'Макс. частота обновлений' },
    hint: { en: 'Upper bound on snapshots per second sent to clients (distinct from sv_maxrate’s byte cap).', ru: 'Верхняя граница числа обновлений в секунду для клиентов (отдельно от байтового лимита sv_maxrate).' },
  },
  sv_minupdaterate: {
    type: 'int', group: { en: 'Voice & Network', ru: 'Голос и сеть' },
    label: { en: 'Min update rate', ru: 'Мин. частота обновлений' },
    hint: { en: 'Lower bound on snapshots per second sent to clients.', ru: 'Нижняя граница числа обновлений в секунду для клиентов.' },
  },
  sv_maxspeed: {
    type: 'int', group: { en: 'Physics', ru: 'Физика' },
    label: { en: 'Max player speed', ru: 'Макс. скорость игрока' },
    hint: { en: 'Top movement speed for players. Retail default is 320 (this server defaults higher).', ru: 'Максимальная скорость передвижения игрока. Стандартное значение — 320 (на этом сервере по умолчанию выше).' },
  },
  sv_gravity: {
    type: 'int', group: { en: 'Physics', ru: 'Физика' },
    label: { en: 'Gravity', ru: 'Гравитация' },
    hint: { en: 'Server gravity strength. Default 800 — lower feels like the moon, higher makes jumping harder.', ru: 'Сила гравитации на сервере. Стандарт — 800. Меньше значение — эффект луны, больше — тяжелее прыгать.' },
  },
  sv_airaccelerate: {
    type: 'int', group: { en: 'Physics', ru: 'Физика' },
    label: { en: 'Air acceleration', ru: 'Ускорение в воздухе' },
    hint: { en: 'Affects bunny-hopping and air-strafing. Default is 10.', ru: 'Влияет на баннихоп и страфы в воздухе. Стандарт — 10.' },
  },
  sv_stepsize: {
    type: 'int', group: { en: 'Physics', ru: 'Физика' },
    label: { en: 'Step height', ru: 'Высота ступеньки' },
    hint: { en: 'Height a player can walk up without jumping. Default 18.', ru: 'Высота, на которую игрок может подняться без прыжка. Стандарт — 18.' },
  },
  sv_bounce: {
    type: 'float', step: '0.1', group: { en: 'Physics', ru: 'Физика' },
    label: { en: 'Surface bounciness', ru: 'Упругость поверхностей' },
    hint: { en: 'How much velocity is retained when bouncing off a surface.', ru: 'Насколько сохраняется скорость при отскоке от поверхности.' },
  },
  sv_friction: {
    type: 'float', step: '0.1', group: { en: 'Physics', ru: 'Физика' },
    label: { en: 'Ground friction', ru: 'Трение о землю' },
    hint: { en: 'How quickly players slow down/stop on the ground. Default 4.', ru: 'Насколько быстро игрок замедляется и останавливается на земле. Стандарт — 4.' },
  },
  sv_wateraccelerate: {
    type: 'int', group: { en: 'Physics', ru: 'Физика' },
    label: { en: 'Water acceleration', ru: 'Ускорение в воде' },
    hint: { en: 'How quickly players accelerate while swimming.', ru: 'Насколько быстро игрок разгоняется при плавании.' },
  },
  sv_waterfriction: {
    type: 'float', step: '0.1', group: { en: 'Physics', ru: 'Физика' },
    label: { en: 'Water friction', ru: 'Трение в воде' },
    hint: { en: 'How quickly players slow down while swimming.', ru: 'Насколько быстро игрок замедляется при плавании.' },
  },
  sv_cheats: {
    type: 'bool', group: { en: 'Physics', ru: 'Физика' },
    label: { en: 'Cheats (sv_cheats)', ru: 'Читы (sv_cheats)' },
    hint: { en: 'Allows cheat commands (noclip, god, notarget, etc.). Keep this off on a live server.', ru: 'Разрешает читерские команды (noclip, god, notarget и т.п.). Держите выключенным на боевом сервере.' },
  },
  pausable: {
    type: 'bool', group: { en: 'Physics', ru: 'Физика' },
    label: { en: 'Allow pause', ru: 'Разрешить паузу' },
    hint: { en: 'Allow players to pause the game with the pause command.', ru: 'Разрешить игрокам ставить игру на паузу командой pause.' },
  },
  sv_allowdownload: {
    type: 'bool', group: { en: 'Resources & Downloads', ru: 'Ресурсы и загрузки' },
    label: { en: 'Allow resource downloads', ru: 'Разрешить загрузку ресурсов' },
    hint: {
      en: 'Lets clients auto-download custom content (maps, sprays) from the server. Needed for custom maps/sprays to reach players who don’t already have them.',
      ru: 'Позволяет клиентам автоматически скачивать с сервера кастомный контент (карты, спреи). Нужно, чтобы у игроков без этих файлов они всё равно подгружались.',
    },
  },
  sv_allowupload: {
    type: 'bool', group: { en: 'Resources & Downloads', ru: 'Ресурсы и загрузки' },
    label: { en: 'Allow resource uploads', ru: 'Разрешить загрузку от игроков' },
    hint: {
      en: 'Lets the server accept custom files from clients (e.g. player sprays) to relay to others.',
      ru: 'Позволяет серверу принимать кастомные файлы от игроков (например, спреи) для показа остальным.',
    },
  },
  mp_consistency: {
    type: 'bool', group: { en: 'Resources & Downloads', ru: 'Ресурсы и загрузки' },
    label: { en: 'Resource consistency check', ru: 'Проверка соответствия ресурсов' },
    hint: {
      en: 'Requires clients’ files to match the server’s for certain resources. Can cause connection issues with mismatched custom content.',
      ru: 'Требует совпадения некоторых файлов у клиента с серверными. Может мешать подключению при несовпадающем кастомном контенте.',
    },
  },
  mp_logmessages: {
    type: 'bool', group: { en: 'Logging', ru: 'Логи' },
    label: { en: 'Log chat messages', ru: 'Логировать сообщения чата' },
    hint: { en: 'Whether in-game chat messages are written to the server log.', ru: 'Записывать ли сообщения игрового чата в лог сервера.' },
  },
  mp_logdetail: {
    type: 'bool', group: { en: 'Logging', ru: 'Логи' },
    label: { en: 'Detailed logging', ru: 'Подробное логирование' },
    hint: { en: 'Extra detail (item pickups, etc.) written to the server log.', ru: 'Дополнительные подробности (подбор предметов и т.п.) в логе сервера.' },
  },
  violence_hblood: {
    type: 'bool', group: { en: 'Gore', ru: 'Насилие' },
    label: { en: 'Human blood', ru: 'Кровь у людей' },
    hint: { en: 'Shows blood effects on human characters.', ru: 'Показывать эффекты крови у персонажей-людей.' },
  },
  violence_hgibs: {
    type: 'bool', group: { en: 'Gore', ru: 'Насилие' },
    label: { en: 'Human gibs', ru: 'Расчленение у людей' },
    hint: { en: 'Shows gore/dismemberment effects on human characters.', ru: 'Показывать эффекты расчленения у персонажей-людей.' },
  },
  violence_ablood: {
    type: 'bool', group: { en: 'Gore', ru: 'Насилие' },
    label: { en: 'Alien blood', ru: 'Кровь у пришельцев' },
    hint: { en: 'Shows blood effects on alien/monster characters (relevant on non-CS GoldSrc mods).', ru: 'Показывать эффекты крови у пришельцев/монстров (актуально для не-CS модов на этом движке).' },
  },
  violence_agibs: {
    type: 'bool', group: { en: 'Gore', ru: 'Насилие' },
    label: { en: 'Alien gibs', ru: 'Расчленение у пришельцев' },
    hint: { en: 'Shows gore/dismemberment effects on alien/monster characters.', ru: 'Показывать эффекты расчленения у пришельцев/монстров.' },
  },
  sv_contact: {
    type: 'text', group: { en: 'Server info', ru: 'Информация о сервере' },
    label: { en: 'Contact email', ru: 'Контактный email' },
    hint: { en: 'Contact address shown to players/tools that query the server info.', ru: 'Контактный адрес, который видят игроки и инструменты, опрашивающие информацию о сервере.' },
  },
  hostname: {
    type: 'text', group: { en: 'Server info', ru: 'Информация о сервере' },
    label: { en: 'Server name', ru: 'Название сервера' },
    hint: {
      en: 'Name shown in the server browser and status. Applies live. Set initially via SERVER_HOSTNAME in .env.',
      ru: 'Название, отображаемое в браузере серверов и статусе. Применяется сразу же. Изначально задаётся через SERVER_HOSTNAME в .env.',
    },
  },
  maxplayers: {
    type: 'int', readonly: true, group: { en: 'Server info', ru: 'Информация о сервере' },
    label: { en: 'Max players', ru: 'Макс. игроков' },
    hint: {
      en: 'Read-only: the engine refuses to change this while the server is running (confirmed live — it prints "cannot be changed while a server is running"). To change it, edit MAXPLAYERS in .env and run "docker compose up -d" to recreate the cs-server container — restarting the process alone re-uses the same container environment, so it won’t pick up a new value.',
      ru: 'Только чтение: движок отказывается менять это значение, пока сервер работает (проверено вживую — выводит "cannot be changed while a server is running"). Чтобы изменить: отредактируйте MAXPLAYERS в .env и выполните "docker compose up -d" — пересоздаст контейнер cs-server. Одного перезапуска процесса недостаточно: он переиспользует то же окружение контейнера.',
    },
  },
  sv_maxrate: {
    type: 'int', group: { en: 'Voice & Network', ru: 'Голос и сеть' },
    label: { en: 'Max bandwidth per client', ru: 'Макс. пропускная способность на клиента' },
    hint: {
      en: 'Upper bound on bytes/sec the server will send to a client. Applies live. Set initially via SV_MAXRATE in .env.',
      ru: 'Верхняя граница байт/сек, отправляемых клиенту сервером. Применяется сразу же. Изначально задаётся через SV_MAXRATE в .env.',
    },
  },
  sv_minrate: {
    type: 'int', group: { en: 'Voice & Network', ru: 'Голос и сеть' },
    label: { en: 'Min bandwidth per client', ru: 'Мин. пропускная способность на клиента' },
    hint: {
      en: 'Lower bound on bytes/sec the server will send to a client. Applies live. Set initially via SV_MINRATE in .env.',
      ru: 'Нижняя граница байт/сек, отправляемых клиенту сервером. Применяется сразу же. Изначально задаётся через SV_MINRATE в .env.',
    },
  },
  sys_ticrate: {
    type: 'int', group: { en: 'Voice & Network', ru: 'Голос и сеть' },
    label: { en: 'Tick rate', ru: 'Тикрейт' },
    hint: {
      en: 'Server network/simulation tick rate. Applies live (verified). Set initially via TICKRATE in .env; 1000 is the classic 1.6 default.',
      ru: 'Тикрейт сети/симуляции сервера. Применяется сразу же (проверено). Изначально задаётся через TICKRATE в .env; 1000 — классическое значение по умолчанию в 1.6.',
    },
  },
};

// The classic retail map pool always ships with the server (see
// server/config/mapcycle.txt), so it's always offered even if the `maps *`
// engine query below doesn't surface it for some reason. Verified directly
// against a live server's `maps *` output (steam_legacy branch install).
const STOCK_MAPS = [
  'as_oilrig', 'cs_747', 'cs_assault', 'cs_backalley', 'cs_estate',
  'cs_havana', 'cs_italy', 'cs_militia', 'cs_office', 'cs_siege',
  'de_airstrip', 'de_aztec', 'de_cbble', 'de_chateau', 'de_dust',
  'de_dust2', 'de_inferno', 'de_nuke', 'de_piranesi', 'de_prodigy',
  'de_storm', 'de_survivor', 'de_torn', 'de_train', 'de_vertigo',
];

function createRouter({ rcon, rconGetChallenge, rconWithChallenge, getStatus, admin, verifyCredentials, wsTokens }) {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!verifyCredentials(admin, username, password)) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    req.session.user = username;
    audit.record(username, 'login', {});
    res.json({ ok: true, user: username });
  });

  router.post('/logout', (req, res) => {
    const user = req.session.user;
    req.session.destroy(() => {
      if (user) audit.record(user, 'logout', {});
      res.json({ ok: true });
    });
  });

  router.get('/me', (req, res) => {
    res.json({ user: req.session.user || null });
  });

  // Everything below requires an authenticated session.
  router.use((req, res, next) => {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'not authenticated' });
  });

  router.get('/ws-token', (req, res) => {
    const token = crypto.randomBytes(24).toString('hex');
    wsTokens.set(token, { user: req.session.user, expires: Date.now() + 30_000 });
    res.json({ token });
  });

  router.get('/status', async (req, res) => {
    res.json(getStatus());
  });

  router.get('/maps', async (req, res, next) => {
    try {
      const raw = await rcon('maps *');
      const found = parseMapList(raw);
      const merged = [...new Set([...STOCK_MAPS, ...found])].sort();
      res.json({ maps: merged });
    } catch (err) {
      next(err);
    }
  });

  router.post('/maps/download', async (req, res, next) => {
    const { name, url } = req.body || {};
    if (!name || !url) return res.status(400).json({ error: 'name and url are required' });
    try {
      const files = await downloadMap(name, url);
      audit.record(req.session.user, 'download_map', { name, url, files });
      res.json({ ok: true, files });
    } catch (err) {
      audit.record(req.session.user, 'download_map_failed', { name, url, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/map', async (req, res, next) => {
    const { map } = req.body || {};
    if (!map || !/^[a-z0-9_-]+$/i.test(map)) {
      return res.status(400).json({ error: 'invalid map name' });
    }
    try {
      const out = await rcon(`changelevel ${map}`);
      audit.record(req.session.user, 'map_change', { map });
      res.json({ ok: true, output: out });
    } catch (err) {
      next(err);
    }
  });

  router.post('/kick', async (req, res, next) => {
    const { userid, reason } = req.body || {};
    if (!userid) return res.status(400).json({ error: 'userid required' });
    try {
      const cmd = reason ? `kick #${userid} "${String(reason).replace(/"/g, "'")}"` : `kick #${userid}`;
      const out = await rcon(cmd);
      audit.record(req.session.user, 'kick', { userid, reason: reason || null });
      res.json({ ok: true, output: out });
    } catch (err) {
      next(err);
    }
  });

  router.post('/ban/steamid', async (req, res, next) => {
    const { steamid, minutes = 0 } = req.body || {};
    if (!steamid) return res.status(400).json({ error: 'steamid required' });
    try {
      await rcon(`banid ${Number(minutes) || 0} ${steamid} kick`);
      const out = await rcon('writeid');
      audit.record(req.session.user, 'ban_steamid', { steamid, minutes });
      res.json({ ok: true, output: out });
    } catch (err) {
      next(err);
    }
  });

  router.post('/unban/steamid', async (req, res, next) => {
    const { steamid } = req.body || {};
    if (!steamid) return res.status(400).json({ error: 'steamid required' });
    try {
      await rcon(`removeid ${steamid}`);
      const out = await rcon('writeid');
      audit.record(req.session.user, 'unban_steamid', { steamid });
      res.json({ ok: true, output: out });
    } catch (err) {
      next(err);
    }
  });

  router.get('/bans/steamid', async (req, res, next) => {
    try {
      res.json({ raw: await rcon('listid') });
    } catch (err) {
      next(err);
    }
  });

  // IP bans matter here because non-Steam ("no-steam") clients commonly all
  // share the same placeholder SteamID, making SteamID bans useless against
  // them — IP banning is the mechanism that actually works in that case.
  router.post('/ban/ip', async (req, res, next) => {
    const { ip, minutes = 0 } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'ip required' });
    try {
      await rcon(`addip ${Number(minutes) || 0} ${ip}`);
      const out = await rcon('writeip');
      audit.record(req.session.user, 'ban_ip', { ip, minutes });
      res.json({ ok: true, output: out });
    } catch (err) {
      next(err);
    }
  });

  router.post('/unban/ip', async (req, res, next) => {
    const { ip } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'ip required' });
    try {
      await rcon(`removeip ${ip}`);
      const out = await rcon('writeip');
      audit.record(req.session.user, 'unban_ip', { ip });
      res.json({ ok: true, output: out });
    } catch (err) {
      next(err);
    }
  });

  router.get('/bans/ip', async (req, res, next) => {
    try {
      res.json({ raw: await rcon('listip') });
    } catch (err) {
      next(err);
    }
  });

  router.post('/password', async (req, res, next) => {
    const { password = '' } = req.body || {};
    try {
      const out = await rcon(`sv_password "${String(password).replace(/"/g, "'")}"`);
      audit.record(req.session.user, 'set_password', { hasPassword: Boolean(password) });
      res.json({ ok: true, output: out });
    } catch (err) {
      next(err);
    }
  });

  router.get('/cvars', (req, res) => {
    res.json({ cvars: CVAR_WHITELIST });
  });

  // Current values, queried live from the engine (`<name>` alone prints
  // `"<name>" is "<value>"`) — sequential, but ~25 short RCON round trips
  // over a LAN/loopback link complete in well under a second in practice.
  router.get('/cvars/values', async (req, res) => {
    // Each query used to be a full independent RCON exchange (its own
    // challenge + command round trip) — sequentially that was ~12s for ~24
    // cvars, and firing them all in parallel still meant 2 UDP exchanges
    // per cvar, which got fragile once the list grew past ~50 (occasional
    // "RCON request timed out" under the traffic burst). A challenge isn't
    // tied to the socket that requested it (verified against a live
    // server), so fetch one challenge and reuse it for every query —
    // roughly halves total RCON traffic — and only fall back to a fresh
    // full exchange for whichever individual query actually fails.
    const names = Object.keys(CVAR_WHITELIST);
    const values = {};
    const challenge = await rconGetChallenge().catch(() => null);

    await Promise.all(
      names.map(async (name) => {
        try {
          let out;
          try {
            if (!challenge) throw new Error('no shared challenge');
            out = await rconWithChallenge(challenge, name);
          } catch {
            out = await rcon(name); // fresh challenge+command fallback
          }
          const m = out.match(/is\s+"([^"]*)"/);
          values[name] = m ? m[1] : null;
        } catch {
          values[name] = null;
        }
      })
    );
    res.json({ values });
  });

  router.post('/cvars/:name', async (req, res, next) => {
    const { name } = req.params;
    const { value } = req.body || {};
    if (!CVAR_WHITELIST[name]) return res.status(400).json({ error: 'cvar not allowed' });
    if (CVAR_WHITELIST[name].readonly) return res.status(400).json({ error: 'cvar is read-only' });
    if (value === undefined || /["\n;]/.test(String(value))) {
      return res.status(400).json({ error: 'invalid value' });
    }
    try {
      const out = await rcon(`${name} ${value}`);
      audit.record(req.session.user, 'set_cvar', { name, value });
      res.json({ ok: true, output: out });
    } catch (err) {
      next(err);
    }
  });

  router.post('/console', async (req, res, next) => {
    const { command } = req.body || {};
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'command required' });
    }
    try {
      const out = await rcon(command);
      audit.record(req.session.user, 'console', { command });
      res.json({ ok: true, output: out });
    } catch (err) {
      next(err);
    }
  });

  // `quit` shuts the engine down cleanly; hlds_run's own supervisor loop
  // ("Auto-restarting the server on crash") then restarts it automatically
  // a few seconds later — verified end-to-end against a live server. This
  // gives a full engine restart (fresh state, reloaded configs) without
  // needing Docker-level access from the panel.
  router.post('/restart', async (req, res, next) => {
    try {
      await rcon('quit');
      audit.record(req.session.user, 'restart_server', {});
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/server/state', (req, res) => {
    res.json({ stopped: serverControl.isStopped() });
  });

  // Genuinely stops the game process (not just restarts it) — sets a flag
  // on the shared control-data volume that entrypoint.sh's restart loop
  // polls; the "quit" here just makes it happen immediately rather than
  // waiting for entrypoint.sh's next poll tick. No RCON call is required to
  // start it back up (nothing to talk to once it's down), so only the flag
  // gets cleared.
  router.post('/server/stop', async (req, res) => {
    serverControl.requestStop();
    await rcon('quit').catch(() => {}); // best-effort; may already be down
    audit.record(req.session.user, 'stop_server', {});
    res.json({ ok: true });
  });

  router.post('/server/start', (req, res) => {
    serverControl.requestStart();
    audit.record(req.session.user, 'start_server', {});
    res.json({ ok: true });
  });

  router.get('/audit', (req, res) => {
    res.json({ entries: audit.recent(200) });
  });

  return router;
}

module.exports = { createRouter };
