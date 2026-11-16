"""Lost & Found, Campus.

A small Flask + SQLite application for reporting lost and found items
around the Flame University campus, with a lightweight matching engine.
"""

from __future__ import annotations

import base64
import binascii
import os
import re
import secrets
import smtplib
import sqlite3
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("LOSTFOUND_DB", BASE_DIR / "lostfound.db"))

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["SECRET_KEY"] = os.environ.get("LOSTFOUND_SECRET_KEY", "dev-only-insecure-key-change-me")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("LOSTFOUND_SECURE_COOKIES", "").lower() in {"1", "true", "yes"}
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)

LOCATIONS = ["Library", "Canteen", "Classroom", "Dorm", "Lab", "Gym", "Parking"]
STATUSES = {"lost", "found"}
EMAIL_RE = re.compile(r"^[a-z0-9._%+-]+@flame\.edu\.in$", re.IGNORECASE)
IMAGE_RE = re.compile(r"^data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$", re.IGNORECASE)
MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_TITLE_CHARS = 120
MAX_DESCRIPTION_CHARS = 800


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

SEED_ITEMS = [
    {
        "title": "Silver MacBook Air on the window seats",
        "description": (
            "Found closed on the second-floor window seats. A 13-inch MacBook Air in space grey "
            "with a small wave sticker on the lid. It is charging at the library help desk now."
        ),
        "location": "Library",
        "status": "found",
        "reporter_name": "Meera Nair",
        "reporter_email": "meera.nair@flame.edu.in",
        "image": "/static/img/laptop-b.jpg",
        "minutes_ago": 26,
    },
    {
        "title": "Space grey MacBook Air with a wave sticker",
        "description": (
            "Last used at the window seats on the second floor. 13-inch MacBook Air, space grey, "
            "white wave sticker on the lid and a small dent on the bottom-left corner. I was carrying a charging cable."
        ),
        "location": "Library",
        "status": "lost",
        "reporter_name": "Aarav Mehta",
        "reporter_email": "aarav.mehta@flame.edu.in",
        "image": None,
        "minutes_ago": 78,
    },
    {
        "title": "iPhone in a navy case at the canteen",
        "description": (
            "Found on a corner table near the juice counter. Blue iPhone in a navy silicone case, "
            "lock screen shows a golden retriever. Turned in to the canteen manager."
        ),
        "location": "Canteen",
        "status": "found",
        "reporter_name": "Dev Patel",
        "reporter_email": "dev.patel@flame.edu.in",
        "image": None,
        "minutes_ago": 96,
    },
    {
        "title": "iPhone 13 with a navy silicone case",
        "description": (
            "Navy MagSafe case with a faint scuff on the back. Lock screen is a photo of a golden retriever. "
            "Last seen at the corner tables near the canteen juice counter."
        ),
        "location": "Canteen",
        "status": "lost",
        "reporter_name": "Ishita Rao",
        "reporter_email": "ishita.rao@flame.edu.in",
        "image": "/static/img/phone.jpg",
        "minutes_ago": 190,
    },
    {
        "title": "Black earbud case by the treadmills",
        "description": (
            "Matte black charging case with one black earbud inside, found on the bench beside "
            "treadmill 4 at the gym."
        ),
        "location": "Gym",
        "status": "found",
        "reporter_name": "Kabir Shah",
        "reporter_email": "kabir.shah@flame.edu.in",
        "image": None,
        "minutes_ago": 240,
    },
    {
        "title": "Black wireless earbuds, one missing",
        "description": (
            "SoundCore earbuds in a matte black charging case. The left earbud is missing. "
            "Left them on the bench near the treadmills during my workout."
        ),
        "location": "Gym",
        "status": "lost",
        "reporter_name": "Rohan Iyer",
        "reporter_email": "rohan.iyer@flame.edu.in",
        "image": None,
        "minutes_ago": 360,
    },
    {
        "title": "Olive steel bottle with a dented cap",
        "description": (
            "Green steel bottle, black cap with a small dent, and a faded chemistry sticker on the side. "
            "Last seen in the lab during the afternoon practical."
        ),
        "location": "Lab",
        "status": "lost",
        "reporter_name": "Sana Kapoor",
        "reporter_email": "sana.kapoor@flame.edu.in",
        "image": "/static/img/bottle.jpg",
        "minutes_ago": 540,
    },
    {
        "title": "Green bottle on lab bench three",
        "description": (
            "Found a green steel bottle with a black cap on bench three after the chemistry practical. "
            "Has a faded sticker on one side. Kept in the lab store room."
        ),
        "location": "Lab",
        "status": "found",
        "reporter_name": "Aarav Mehta",
        "reporter_email": "aarav.mehta@flame.edu.in",
        "image": None,
        "minutes_ago": 660,
    },
    {
        "title": "Student ID card on a navy lanyard",
        "description": (
            "Lost my student ID somewhere between C-block and the library. Navy lanyard with a small "
            "brass key attached. The card is under Tara Menon."
        ),
        "location": "Classroom",
        "status": "lost",
        "reporter_name": "Tara Menon",
        "reporter_email": "tara.menon@flame.edu.in",
        "image": None,
        "minutes_ago": 1440,
    },
    {
        "title": "Student ID left near the C-block desks",
        "description": (
            "Found a student ID on a navy lanyard with a small brass key attached, on a desk in C-block "
            "after the morning lecture."
        ),
        "location": "Classroom",
        "status": "found",
        "reporter_name": "Ishita Rao",
        "reporter_email": "ishita.rao@flame.edu.in",
        "image": None,
        "minutes_ago": 1560,
    },
    {
        "title": "Black ThinkPad in study room 204",
        "description": (
            "A black Lenovo ThinkPad was left on the desk in study room 204, charging cable still attached. "
            "Brought it to the library help desk."
        ),
        "location": "Library",
        "status": "found",
        "reporter_name": "Kabir Shah",
        "reporter_email": "kabir.shah@flame.edu.in",
        "image": None,
        "minutes_ago": 1800,
    },
    {
        "title": "Navy backpack with a yellow logo tag",
        "description": (
            "Black and navy backpack with a padded laptop sleeve and a yellow logo tag. Left it on a chair "
            "in the library reading room on Tuesday evening."
        ),
        "location": "Library",
        "status": "lost",
        "reporter_name": "Meera Nair",
        "reporter_email": "meera.nair@flame.edu.in",
        "image": "/static/img/backpack.jpg",
        "minutes_ago": 1980,
    },
    {
        "title": "Cycle keys on a red carabiner",
        "description": (
            "Two silver keys and a smaller bike-lock key on a red carabiner. Probably dropped near the "
            "north-side cycle racks."
        ),
        "location": "Parking",
        "status": "lost",
        "reporter_name": "Dev Patel",
        "reporter_email": "dev.patel@flame.edu.in",
        "image": None,
        "minutes_ago": 2880,
    },
    {
        "title": "Keyring with a bottle opener",
        "description": (
            "Found near the cycle racks: two silver keys, a red clip and a small bottle opener. "
            "Kept at the parking desk."
        ),
        "location": "Parking",
        "status": "found",
        "reporter_name": "Tara Menon",
        "reporter_email": "tara.menon@flame.edu.in",
        "image": None,
        "minutes_ago": 3060,
    },
    {
        "title": "Tortoise-shell glasses on the canteen table",
        "description": (
            "Black and amber glasses left on a table by the window. No case, one lens has a small scratch. "
            "At the canteen counter."
        ),
        "location": "Canteen",
        "status": "found",
        "reporter_name": "Sana Kapoor",
        "reporter_email": "sana.kapoor@flame.edu.in",
        "image": "/static/img/glasses.jpg",
        "minutes_ago": 4200,
    },
    {
        "title": "Casio calculator, name taped inside",
        "description": (
            "Casio FX-991EX with white tape on the battery cover. Left it in classroom 12, likely after "
            "the stats lecture."
        ),
        "location": "Classroom",
        "status": "lost",
        "reporter_name": "Rohan Iyer",
        "reporter_email": "rohan.iyer@flame.edu.in",
        "image": None,
        "minutes_ago": 4320,
    },
    {
        "title": "White calculator in classroom 12",
        "description": (
            "Found a white calculator under a desk in classroom 12 after the stats lecture. Has a strip of "
            "white tape on the back; keeping it at the front office."
        ),
        "location": "Classroom",
        "status": "found",
        "reporter_name": "Dev Patel",
        "reporter_email": "dev.patel@flame.edu.in",
        "image": "/static/img/calculator.jpg",
        "minutes_ago": 4560,
    },
    {
        "title": "Green umbrella with a wooden handle",
        "description": (
            "Short green umbrella, wooden J-handle, left near the library entrance on a rainy afternoon."
        ),
        "location": "Library",
        "status": "lost",
        "reporter_name": "Meera Nair",
        "reporter_email": "meera.nair@flame.edu.in",
        "image": None,
        "minutes_ago": 5040,
    },
    {
        "title": "Blue scarf in the dorm lounge",
        "description": (
            "A soft blue scarf was left on the common-room sofa in the dorm on Sunday evening. "
            "Kept at the dorm reception."
        ),
        "location": "Dorm",
        "status": "found",
        "reporter_name": "Sana Kapoor",
        "reporter_email": "sana.kapoor@flame.edu.in",
        "image": None,
        "minutes_ago": 5760,
    },
    {
        "title": "Physics notebook, grey cover",
        "description": (
            "Spiral-bound notebook with a grey cover and a week's worth of thermodynamics notes. "
            "Possibly left in the dorm study room."
        ),
        "location": "Dorm",
        "status": "lost",
        "reporter_name": "Rohan Iyer",
        "reporter_email": "rohan.iyer@flame.edu.in",
        "image": "/static/img/notebook.jpg",
        "minutes_ago": 5880,
    },
]


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def parse_iso(value: str | None) -> datetime:
    if not value:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def connect_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect_db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('lost', 'found')),
                reporter_name TEXT NOT NULL,
                reporter_email TEXT NOT NULL,
                image TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                verified INTEGER NOT NULL DEFAULT 0,
                verification_token TEXT,
                verification_expires TEXT,
                reset_token TEXT,
                reset_expires TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_items_created_at
                ON items (created_at DESC);
            """
        )
        existing = connection.execute("SELECT COUNT(*) FROM items").fetchone()[0]
        if existing:
            return

        now = utc_now()
        for item in SEED_ITEMS:
            connection.execute(
                """
                INSERT INTO items
                    (title, description, location, status, reporter_name,
                     reporter_email, image, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["title"],
                    item["description"],
                    item["location"],
                    item["status"],
                    item["reporter_name"],
                    item["reporter_email"],
                    item["image"],
                    iso_timestamp(now - timedelta(minutes=item["minutes_ago"])),
                ),
            )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def display_name_from_email(email: str) -> str:
    local = email.split("@", 1)[0]
    words = [part for part in re.split(r"[._+-]+", local) if part]
    name = " ".join(word[:1].upper() + word[1:] for word in words)
    return (name or "Flame student")[:80]


def initials_for(name: str) -> str:
    parts = [part for part in name.split() if part]
    return "".join(part[0] for part in parts[:2]).upper() or "FS"


def normalize_email(value: object) -> str | None:
    email = str(value or "").strip().lower()
    if (
        not email
        or len(email) > 160
        or not EMAIL_RE.fullmatch(email)
    ):
        return None
    return email


def validate_password(password: str) -> str | None:
    if len(password) < 8:
        return "Password must be at least 8 characters long."
    if not re.search(r"[A-Za-z]", password) or not re.search(r"[0-9]", password):
        return "Password must include at least one letter and one number."
    return None


def app_base_url() -> str:
    return os.environ.get("LOSTFOUND_BASE_URL", "http://127.0.0.1:5057").rstrip("/")


def send_email(to: str, subject: str, body: str) -> bool:
    host = os.environ.get("LOSTFOUND_SMTP_HOST", "").strip()
    if not host:
        return False
    port = int(os.environ.get("LOSTFOUND_SMTP_PORT", "587"))
    username = os.environ.get("LOSTFOUND_SMTP_USER", "").strip()
    password = os.environ.get("LOSTFOUND_SMTP_PASSWORD", "")
    sender = os.environ.get("LOSTFOUND_SMTP_FROM", username or "noreply@flame.edu.in")
    use_tls = os.environ.get("LOSTFOUND_SMTP_TLS", "true").lower() not in {"0", "false", "no"}

    message = EmailMessage()
    message["From"] = sender
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    try:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.ehlo()
            if use_tls:
                server.starttls()
                server.ehlo()
            if username:
                server.login(username, password)
            server.send_message(message)
        return True
    except (OSError, smtplib.SMTPException):
        return False


def clean_text(value: object, field: str, max_length: int, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ApiError(f"{field} must be text.")
    text = value.replace("\x00", "").strip()
    if required and not text:
        raise ApiError(f"{field} is required.")
    if len(text) > max_length:
        raise ApiError(f"{field} must be {max_length} characters or fewer.")
    return text


def clean_image(value: object) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ApiError("The photo could not be read.")
    if len(value) > int(MAX_IMAGE_BYTES * 1.45):
        raise ApiError("That photo is too large. Please try one under 3 MB.")
    match = IMAGE_RE.fullmatch(value.strip())
    if not match:
        raise ApiError("Photos must be PNG, JPG, WEBP, or GIF files.")
    encoded = re.sub(r"\s+", "", match.group(2))
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError("That photo could not be decoded. Please try another file.") from None
    if len(decoded) > MAX_IMAGE_BYTES:
        raise ApiError("That photo is too large. Please try one under 3 MB.")
    mime = match.group(1).lower()
    return f"data:image/{mime};base64,{encoded}"


def escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# ---------------------------------------------------------------------------
# Voice transcript refinement
# ---------------------------------------------------------------------------

LOCATION_HINTS = {
    "Library": (r"\blibrary\b", r"\breading room\b", r"\bstudy room\b", r"\bhelp desk\b"),
    "Canteen": (r"\bcanteen\b", r"\bcafeteria\b", r"\bmess\b", r"\bjuice counter\b", r"\bfood court\b"),
    "Classroom": (
        r"\bclassroom\b", r"\bclass room\b", r"\blecture hall\b",
        r"\bc[\s-]?block\b", r"\bclass\b",
    ),
    "Dorm": (r"\bdorm\b", r"\bhostel\b", r"\bcommon room\b", r"\bcommon-room\b"),
    "Lab": (r"\blab\b", r"\blaboratory\b", r"\bworkshop\b", r"\bpractical\b"),
    "Gym": (r"\bgym\b", r"\bfitness\b", r"\btreadmill\b", r"\bworkout\b"),
    "Parking": (r"\bparking\b", r"\bcycle rack\b", r"\bbike rack\b", r"\bcar park\b"),
}

STATUS_HINTS = (
    (r"\b(?:i|we)\s+(?:just\s+|think\s+i\s+)?(?:lost|misplaced)\b", "lost"),
    (r"\b(?:lost|missing|misplaced)\s+(?:my|a|an|the|this|these|it)\b", "lost"),
    (r"\b(?:i|we)\s+(?:have\s+|just\s+)?left\s+(?:my|a|an|the|this)\b", "lost"),
    (r"\b(?:can'?t|cannot|can\s+not)\s+find\b", "lost"),
    (r"\b(?:i|we)\s+(?:just\s+)?found\b", "found"),
    (r"\b(?:was|is|were|been)\s+found\b", "found"),
    (r"\bfound\s+(?:this|these|a|an|the|my)\b", "found"),
    (r"\bsomeone\s+(?:found|handed|turned)\b", "found"),
    (r"\bturned\s+in\b", "found"),
)

FILLER_RE = re.compile(
    r"\b(?:um+|uh+|erm+|ah+|hmm+|you know|i mean|sort of|kind of|like i said)\b[,]?",
    re.IGNORECASE,
)

ASR_FIXES = (
    (re.compile(r"\bi[\s-]?phone\b", re.IGNORECASE), "iPhone"),
    (re.compile(r"\bair[\s-]?pods?\b", re.IGNORECASE), "AirPods"),
    (re.compile(r"\bmac[\s-]?book\b", re.IGNORECASE), "MacBook"),
    (re.compile(r"\bthink[\s-]?pad\b", re.IGNORECASE), "ThinkPad"),
    (re.compile(r"\b(?:i[\s-]?d|id)\s+card\b", re.IGNORECASE), "ID card"),
    (re.compile(r"\bwi[\s-]?fi\b", re.IGNORECASE), "Wi-Fi"),
)

TITLE_CUT_RE = re.compile(
    r"\b(?:at|in|on|near|outside|inside|around|from|by|somewhere|"
    r"yesterday|today|tonight|tomorrow|during|after|before|while|because|"
    r"last|used|left|kept|seen|found|lost|missing|sitting|placed|lying|dropped)\b",
    re.IGNORECASE,
)

TITLE_CASING = (
    (re.compile(r"\bmacbook\s+air\b", re.IGNORECASE), "MacBook Air"),
    (re.compile(r"\bmacbook\s+pro\b", re.IGNORECASE), "MacBook Pro"),
    (re.compile(r"\bmacbook\b", re.IGNORECASE), "MacBook"),
    (re.compile(r"\bthinkpad\b", re.IGNORECASE), "ThinkPad"),
    (re.compile(r"\biphone\b", re.IGNORECASE), "iPhone"),
    (re.compile(r"\bipad\b", re.IGNORECASE), "iPad"),
    (re.compile(r"\bairpods\b", re.IGNORECASE), "AirPods"),
    (re.compile(r"\bcasio\b", re.IGNORECASE), "Casio"),
)

TITLE_LEAD_RE = re.compile(
    r"^(?:(?:hey|hi|hello|so|okay|ok|yeah|well|please|actually|basically)[, ]+)?"
    r"(?:"
    r"i\s+(?:want|need|would\s+like)\s+to\s+(?:report|say)|"
    r"i(?:'m| am)\s+(?:reporting|looking\s+for)|"
    r"i\s+(?:can'?t|cannot|can\s+not)\s+find|"
    r"(?:can'?t|cannot|can\s+not)\s+find|"
    r"this\s+is|"
    r"help\s+me\s+find|"
    r"there\s+is|there's|"
    r"someone\s+(?:found|turned\s+in)|"
    r"(?:lost|found|misplaced)|"
    r"i\s+(?:think\s+)?(?:i\s+)?(?:have\s+|just\s+)?(?:lost|found|misplaced|left)|"
    r"we\s+(?:have\s+|just\s+)?(?:lost|found|misplaced|left)"
    r")\s+",
    re.IGNORECASE,
)

ARTICLE_RE = re.compile(r"^(?:my|a|an|the|this|these|that|those)\s+", re.IGNORECASE)


def tidy_transcript(text: str) -> str:
    value = str(text or "")
    value = (
        value.replace("\u2014", ", ")
        .replace("\u2013", ", ")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
    )
    value = re.sub(r"\s+", " ", value).strip()
    value = FILLER_RE.sub(" ", value)
    for pattern, replacement in ASR_FIXES:
        value = pattern.sub(replacement, value)
    for pattern, replacement in TITLE_CASING:
        value = pattern.sub(replacement, value)
    value = re.sub(r"\s+([,.!?])", r"\1", value)
    value = re.sub(r",(?:\s*,)+", ",", value)
    value = re.sub(r"\b(\w+)(?:\s+\1\b)+", r"\1", value, flags=re.IGNORECASE)
    value = re.sub(r"\s+", " ", value).strip(" ,;:")
    return value


def detect_status(text: str, fallback: str) -> str:
    lowered = text.lower()
    hits: list[tuple[int, str]] = []
    for pattern, status in STATUS_HINTS:
        match = re.search(pattern, lowered)
        if match:
            hits.append((match.start(), status))
    if not hits:
        return fallback
    hits.sort()
    return hits[0][1]


def detect_location(text: str) -> str:
    lowered = text.lower()
    best: tuple[int, str] | None = None
    for location, patterns in LOCATION_HINTS.items():
        for pattern in patterns:
            match = re.search(pattern, lowered)
            if match and (best is None or match.start() < best[0]):
                best = (match.start(), location)
    return best[1] if best else ""


def sentence_case(text: str) -> str:
    if not text:
        return ""
    value = text[0].upper() + text[1:]
    value = re.sub(r"\bi\b", "I", value)
    return value


def extract_title(text: str, status: str) -> str:
    value = tidy_transcript(text)
    value = TITLE_LEAD_RE.sub("", value, count=1)
    value = ARTICLE_RE.sub("", value, count=1)
    value = re.sub(r"^(?:was|were|is|are)\s+", "", value, flags=re.IGNORECASE)
    value = re.sub(r"^(?:a|an|the)\s+", "", value, flags=re.IGNORECASE)

    cut = TITLE_CUT_RE.search(value)
    if cut and cut.start() >= 3:
        candidate = value[: cut.start()].strip(" ,;:-")
        if len(candidate) >= 3:
            value = candidate

    value = re.sub(r"[\s,;:.!?\-]+$", "", value)
    value = re.sub(
        r"\b(?:and|with|for|of|to|that|which|who|is|was|were|has|have|had)$",
        "",
        value,
        flags=re.IGNORECASE,
    ).strip(" ,;:")

    value = value[:90].rsplit(" ", 1)[0] if len(value) > 90 else value
    value = sentence_case(value.strip())
    for pattern, replacement in TITLE_CASING:
        value = pattern.sub(replacement, value)

    if len(value) < 3 or value.lower() in {"it", "this", "that", "something", "stuff", "thing"}:
        return "Lost item" if status == "lost" else "Found item"
    return value


def build_description(text: str, title: str, status: str, location: str) -> str:
    value = tidy_transcript(text)
    value = re.sub(
        r"^(?:so|okay|ok|yeah|well|hey|hi|hello|please)[, ]+",
        "",
        value,
        count=1,
        flags=re.IGNORECASE,
    ).strip()
    value = sentence_case(value)
    value = re.sub(r"[\s,;:]+$", "", value)
    if value and value[-1] not in ".!?":
        value += "."

    if len(value) < 24:
        parts = [value] if value else []
        tail = "Lost" if status == "lost" else "Found"
        if location:
            tail += f" at the {location}"
        tail += "."
        if tail.lower() not in value.lower():
            parts.append(tail)
        value = " ".join(parts).strip()

    if value.rstrip(".").lower() == title.lower():
        label = "Lost" if status == "lost" else "Found"
        suffix = f" at the {location}" if location else ""
        value = f"{label}{suffix}."

    return value[:MAX_DESCRIPTION_CHARS]


def local_refine(text: str, fallback_status: str) -> dict:
    cleaned = tidy_transcript(text)
    status = detect_status(cleaned, fallback_status)
    location = detect_location(cleaned)
    title = extract_title(cleaned, status)
    description = build_description(cleaned, title, status, location)
    return {
        "title": title[:MAX_TITLE_CHARS],
        "description": description,
        "status": status,
        "location": location,
        "cleaned": cleaned,
    }


def openai_refine(text: str, fallback_status: str) -> dict | None:
    """Optional refinement when OPENAI_API_KEY is configured.

    The local refiner always runs first, so a missing key, network failure,
    or malformed response never blocks the report.
    """
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None

    import json
    import urllib.error
    import urllib.request

    model = os.environ.get("OPENAI_REFINE_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    system = (
        "You turn a spoken campus lost-and-found note into a clean report. "
        "Reply with JSON only, using this shape: "
        '{"title": string, "description": string, "status": "lost" or "found", '
        '"location": one of Library, Canteen, Classroom, Dorm, Lab, Gym, Parking, or ""}. '
        "The title must be under 90 characters and must not begin with Lost or Found. "
        "The description must be one to three plain sentences and must not invent details. "
        f"If the note does not make the status clear, use {fallback_status}. "
        "Never use em dashes."
    )
    body = json.dumps(
        {
            "model": model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": text[:2400]},
            ],
        }
    ).encode("utf-8")

    request_obj = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request_obj, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        content = payload["choices"][0]["message"]["content"]
        content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.IGNORECASE).strip()
        data = json.loads(content)
    except (KeyError, IndexError, ValueError, TypeError, OSError, urllib.error.URLError):
        return None
    except Exception:
        return None

    title = tidy_transcript(str(data.get("title", "")))[:MAX_TITLE_CHARS]
    description = tidy_transcript(str(data.get("description", "")))[:MAX_DESCRIPTION_CHARS]
    status = str(data.get("status", "")).strip().lower()
    location = str(data.get("location", "")).strip()

    if not title or len(title) < 3:
        return None

    return {
        "title": title,
        "description": description,
        "status": status if status in STATUSES else fallback_status,
        "location": location if location in LOCATIONS else "",
    }


def serialize_item(row: sqlite3.Row, include_email: bool = False) -> dict:
    item = {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "location": row["location"],
        "status": row["status"],
        "reporter_name": row["reporter_name"],
        "reporter_initials": initials_for(row["reporter_name"]),
        "image": row["image"],
        "created_at": row["created_at"],
    }
    if include_email:
        item["reporter_email"] = row["reporter_email"]
    return item


def fetch_all_item_rows() -> list[sqlite3.Row]:
    with connect_db() as connection:
        return connection.execute(
            "SELECT * FROM items ORDER BY created_at DESC, id DESC"
        ).fetchall()


# ---------------------------------------------------------------------------
# Matching engine
# ---------------------------------------------------------------------------

STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "with",
    "my", "me", "i", "is", "it", "its", "this", "that", "these", "those", "some",
    "someone", "please", "help", "if", "was", "were", "had", "has", "have", "been",
    "not", "no", "yes", "about", "around", "near", "by", "from", "after", "before",
    "during", "left", "lost", "found", "kept", "last", "seen", "used", "carrying",
    "library", "canteen", "classroom", "dorm", "lab", "gym", "parking", "campus",
    "flame", "university", "today", "yesterday", "morning", "afternoon", "evening",
    "day", "week", "small", "one", "two", "three", "strip", "them", "still",
}

SYNONYMS = {
    "macbook": "laptop",
    "macbooks": "laptop",
    "thinkpad": "laptop",
    "lenovo": "laptop",
    "computer": "laptop",
    "computers": "laptop",
    "laptops": "laptop",
    "iphone": "phone",
    "iphones": "phone",
    "smartphone": "phone",
    "phones": "phone",
    "airpod": "earphone",
    "airpods": "earphone",
    "earbud": "earphone",
    "earbuds": "earphone",
    "earphone": "earphone",
    "earphones": "earphone",
    "headphone": "earphone",
    "headphones": "earphone",
    "bottles": "bottle",
    "flask": "bottle",
    "key": "key",
    "keys": "key",
    "keyring": "key",
    "keychain": "key",
    "spectacles": "glasses",
    "bike": "cycle",
    "bikes": "cycle",
    "bicycle": "cycle",
    "cycles": "cycle",
    "backpacks": "backpack",
    "bag": "backpack",
    "bags": "backpack",
    "calculators": "calculator",
    "notebooks": "notebook",
    "umbrellas": "umbrella",
    "scarves": "scarf",
    "chargers": "charger",
    "cards": "card",
    "wallets": "wallet",
}

CATEGORY_TERMS = {
    "laptop": "Laptop",
    "phone": "Phone",
    "earphone": "Earbuds",
    "bottle": "Bottle",
    "id": "Student ID",
    "key": "Keys",
    "calculator": "Calculator",
    "glasses": "Glasses",
    "cycle": "Cycle",
    "backpack": "Backpack",
    "notebook": "Notebook",
    "umbrella": "Umbrella",
    "scarf": "Scarf",
    "wallet": "Wallet",
    "charger": "Charger",
}

BRANDS = {
    "apple": "apple",
    "macbook": "apple",
    "iphone": "apple",
    "airpods": "apple",
    "ipad": "apple",
    "lenovo": "lenovo",
    "thinkpad": "lenovo",
    "casio": "casio",
    "soundcore": "soundcore",
    "samsung": "samsung",
    "pixel": "google",
    "google": "google",
    "oneplus": "oneplus",
    "dell": "dell",
    "asus": "asus",
    "boat": "boat",
}


def tokenize(text: str) -> tuple[set[str], set[str]]:
    """Return (canonical tokens, original lowercase words) for matching."""
    canonical: set[str] = set()
    original: set[str] = set()
    for word in re.findall(r"[a-z0-9]+", text.lower()):
        if len(word) < 2 or word in STOPWORDS:
            continue
        original.add(word)
        canonical.add(SYNONYMS.get(word, word))
    return canonical, original


def brand_set(text: str) -> set[str]:
    lowered = text.lower()
    found = set()
    for alias, brand in BRANDS.items():
        if re.search(rf"\b{re.escape(alias)}\b", lowered):
            found.add(brand)
    return found


def score_pair(lost_row: sqlite3.Row, found_row: sqlite3.Row) -> dict | None:
    if lost_row["location"] != found_row["location"]:
        return None

    lost_title, lost_title_original = tokenize(lost_row["title"])
    found_title, found_title_original = tokenize(found_row["title"])
    lost_desc, lost_desc_original = tokenize(lost_row["description"])
    found_desc, found_desc_original = tokenize(found_row["description"])

    lost_brands = brand_set(lost_row["title"] + " " + lost_row["description"])
    found_brands = brand_set(found_row["title"] + " " + found_row["description"])
    if lost_brands and found_brands and not (lost_brands & found_brands):
        return None

    shared_title = lost_title & found_title
    shared_desc = (lost_desc & found_desc) - shared_title
    if not shared_title and len(shared_desc) < 2:
        return None

    score = 50
    score += min(35, len(shared_title) * 20)
    score += min(15, len(shared_desc) * 4)
    score = min(98, score)
    if score < 60:
        return None

    shared_original_title = sorted(lost_title_original & found_title_original)
    shared_original_desc = sorted(
        (lost_desc_original & found_desc_original)
        - set(shared_original_title)
    )
    display_terms = shared_original_title + shared_original_desc

    def pretty_term(term: str) -> str:
        if term.lower() == "macbook":
            return "MacBook"
        if term.lower() == "iphone":
            return "iPhone"
        if term.lower() == "id":
            return "ID"
        return term

    shared_terms = [pretty_term(term) for term in display_terms[:4]]
    reasons = [f"Both at {lost_row['location']}"]
    if shared_terms:
        reasons.append("Shared details: " + ", ".join(shared_terms))

    if score >= 85:
        label = "Strong match"
    elif score >= 72:
        label = "Likely match"
    else:
        label = "Possible match"

    return {
        "id": f"{lost_row['id']}-{found_row['id']}",
        "score": score,
        "label": label,
        "location": lost_row["location"],
        "reasons": reasons,
        "shared_terms": shared_terms,
        "lost": serialize_item(lost_row, include_email=True),
        "found": serialize_item(found_row, include_email=True),
    }


def build_matches(rows: list[sqlite3.Row]) -> list[dict]:
    lost_rows = [row for row in rows if row["status"] == "lost"]
    found_rows = [row for row in rows if row["status"] == "found"]
    matches = []
    for lost_row in lost_rows:
        for found_row in found_rows:
            match = score_pair(lost_row, found_row)
            if match:
                matches.append(match)
    matches.sort(
        key=lambda match: (
            -match["score"],
            match["lost"]["created_at"],
            match["found"]["created_at"],
        )
    )
    return matches


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/auth/register")
def register():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    if not email:
        raise ApiError("Use a valid Flame email address ending in @flame.edu.in.")
    name = str(payload.get("name") or "").strip()[:80] or display_name_from_email(email)
    password = payload.get("password")
    if not isinstance(password, str):
        raise ApiError("Password is required.")
    error = validate_password(password)
    if error:
        raise ApiError(error)

    with connect_db() as connection:
        existing = connection.execute(
            "SELECT id, verified FROM users WHERE email = ?", (email,)
        ).fetchone()
        if existing:
            raise ApiError("An account with that email already exists.")
        token = secrets.token_urlsafe(32)
        token_hash = generate_password_hash(token)
        connection.execute(
            """
            INSERT INTO users (email, name, password_hash, verified, verification_token,
                              verification_expires, created_at)
            VALUES (?, ?, ?, 0, ?, ?, ?)
            """,
            (
                email,
                name,
                generate_password_hash(password),
                token_hash,
                iso_timestamp(utc_now() + timedelta(hours=24)),
                iso_timestamp(utc_now()),
            ),
        )

    link = f"{app_base_url()}/?verify={token}&email={email}"
    body = (
        f"Hi {name},\\n\\n"
        f"Verify your Flame Lost & Found account by opening this link:\\n{link}\\n\\n"
        f"The link expires in 24 hours. If you did not create this account, ignore this email.\\n"
    )
    sent = send_email(email, "Verify your Flame Lost & Found account", body)
    return jsonify({"ok": True, "email_sent": sent, "verification_token": token if not sent else None})


@app.get("/api/auth/verify")
def verify_email():
    token = str(request.args.get("token") or "").strip()
    email = normalize_email(request.args.get("email"))
    if not token or not email:
        raise ApiError("Verification link is invalid.")
    with connect_db() as connection:
        row = connection.execute(
            "SELECT id, verification_token, verification_expires FROM users WHERE email = ?",
            (email,),
        ).fetchone()
        if row is None or not row["verification_token"]:
            raise ApiError("Verification link is invalid or already used.", 400)
        if not check_password_hash(row["verification_token"], token):
            raise ApiError("Verification link is invalid.", 400)
        if row["verification_expires"] and parse_iso(row["verification_expires"]) < utc_now():
            raise ApiError("Verification link has expired. Request a new one.", 400)
        connection.execute(
            "UPDATE users SET verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?",
            (row["id"],),
        )
    return jsonify({"ok": True, "verified": True})


@app.post("/api/auth/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    password = payload.get("password")
    if not email or not isinstance(password, str):
        raise ApiError("Use a valid Flame email and password.")
    with connect_db() as connection:
        row = connection.execute(
            "SELECT id, name, password_hash, verified FROM users WHERE email = ?", (email,)
        ).fetchone()
    if row is None or not check_password_hash(row["password_hash"], password):
        raise ApiError("Invalid email or password.")
    if not row["verified"]:
        raise ApiError("Please verify your email before signing in.", 403)
    session.clear()
    session["user_email"] = email
    session["user_name"] = row["name"]
    session.permanent = True
    return jsonify(
        {
            "user": {
                "email": email,
                "name": row["name"],
                "initials": initials_for(row["name"]),
            }
        }
    )


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.post("/api/auth/forgot")
def forgot_password():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    if not email:
        raise ApiError("Use a valid Flame email address.")
    with connect_db() as connection:
        row = connection.execute("SELECT id, name FROM users WHERE email = ?", (email,)).fetchone()
        if row:
            token = secrets.token_urlsafe(32)
            connection.execute(
                "UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?",
                (
                    generate_password_hash(token),
                    iso_timestamp(utc_now() + timedelta(hours=1)),
                    row["id"],
                ),
            )
            link = f"{app_base_url()}/?reset={token}&email={email}"
            body = (
                f"Hi {row['name']},\\n\\n"
                f"Reset your Flame Lost & Found password by opening this link:\\n{link}\\n\\n"
                f"The link expires in 1 hour. If you did not request this, ignore this email.\\n"
            )
            send_email(email, "Reset your Flame Lost & Found password", body)
    # Always return success to avoid revealing whether email is registered
    return jsonify({"ok": True})


@app.post("/api/auth/reset")
def reset_password():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    token = str(payload.get("token") or "").strip()
    password = payload.get("password")
    if not email or not token or not isinstance(password, str):
        raise ApiError("Invalid reset request.")
    error = validate_password(password)
    if error:
        raise ApiError(error)
    with connect_db() as connection:
        row = connection.execute(
            "SELECT id, reset_token, reset_expires FROM users WHERE email = ?", (email,)
        ).fetchone()
        if row is None or not row["reset_token"]:
            raise ApiError("Reset link is invalid or already used.", 400)
        if not check_password_hash(row["reset_token"], token):
            raise ApiError("Reset link is invalid.", 400)
        if row["reset_expires"] and parse_iso(row["reset_expires"]) < utc_now():
            raise ApiError("Reset link has expired. Request a new one.", 400)
        connection.execute(
            "UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?",
            (generate_password_hash(password), row["id"]),
        )
    return jsonify({"ok": True})


@app.get("/api/auth/me")
def me():
    email = session.get("user_email")
    if not email:
        return jsonify({"user": None})
    name = session.get("user_name") or display_name_from_email(email)
    return jsonify({"user": {"email": email, "name": name, "initials": initials_for(name)}})


@app.get("/api/items")
def list_items():
    query = request.args.get("q", "").strip()
    status = request.args.get("status", "all").strip().lower()
    location = request.args.get("location", "all").strip()

    conditions: list[str] = []
    params: list[object] = []

    if query:
        if len(query) > 120:
            raise ApiError("Search is too long.")
        for term in query.split()[:6]:
            like = f"%{escape_like(term)}%"
            conditions.append(
                "(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\')"
            )
            params.extend([like, like, like])

    if status in STATUSES:
        conditions.append("status = ?")
        params.append(status)

    if location and location != "all":
        conditions.append("location = ?")
        params.append(location)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    with connect_db() as connection:
        total = connection.execute(
            f"SELECT COUNT(*) FROM items {where_clause}", params
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT * FROM items
            {where_clause}
            ORDER BY created_at DESC, id DESC
            LIMIT 100
            """,
            params,
        ).fetchall()

    return jsonify(
        {
            "items": [serialize_item(row) for row in rows],
            "count": len(rows),
            "total": total,
            "query": {
                "q": query,
                "status": status if status in STATUSES else "all",
                "location": location if location in LOCATIONS else "all",
            },
        }
    )


@app.get("/privacy")
def privacy():
    return render_template("index.html")


@app.post("/api/refine")
def refine_transcript():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ApiError("Send the transcript as JSON.")

    transcript = payload.get("transcript")
    if not isinstance(transcript, str):
        raise ApiError("The transcript must be text.")

    transcript = transcript.replace("\x00", "").strip()
    if len(transcript) < 2:
        raise ApiError("Say a little more so the report can be written.")
    if len(transcript) > 2400:
        transcript = transcript[:2400]

    requested_status = str(payload.get("status", "")).strip().lower()
    fallback_status = requested_status if requested_status in STATUSES else "lost"

    refined = local_refine(transcript, fallback_status)
    ai_refined = openai_refine(refined["cleaned"], fallback_status)
    if ai_refined:
        refined.update(ai_refined)
        refined["source"] = "openai"
    else:
        refined["source"] = "local"

    refined["note"] = (
        "Refined into a title and description. Read it once before posting."
        if refined["source"] == "openai"
        else "Tidied into a title and description. Read it once before posting."
    )
    return jsonify(refined)


@app.get("/api/items/<int:item_id>")
def get_item(item_id: int):
    with connect_db() as connection:
        row = connection.execute(
            "SELECT * FROM items WHERE id = ?", (item_id,)
        ).fetchone()
    if row is None:
        raise ApiError("That report could not be found.", 404)
    return jsonify({"item": serialize_item(row, include_email=True)})


@app.post("/api/items")
def create_item():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ApiError("Send the report as JSON.")

    title = clean_text(payload.get("title"), "Title", MAX_TITLE_CHARS, required=True)
    description = clean_text(
        payload.get("description"), "Description", MAX_DESCRIPTION_CHARS
    )
    location = clean_text(payload.get("location"), "Location", 40, required=True)
    status = str(payload.get("status", "")).strip().lower()
    email = normalize_email(payload.get("reporter_email"))
    image = clean_image(payload.get("image"))

    if status not in STATUSES:
        raise ApiError("Choose whether the item was lost or found.")
    if not email:
        raise ApiError("Sign in with a valid @flame.edu.in email to report an item.")
    if title.isdigit():
        raise ApiError("Add a short description to the item title.")

    name = display_name_from_email(email)
    created_at = iso_timestamp(utc_now())

    with connect_db() as connection:
        cursor = connection.execute(
            """
            INSERT INTO items
                (title, description, location, status, reporter_name,
                 reporter_email, image, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (title, description, location, status, name, email, image, created_at),
        )
        item_id = cursor.lastrowid
        row = connection.execute(
            "SELECT * FROM items WHERE id = ?", (item_id,)
        ).fetchone()

        all_rows = connection.execute("SELECT * FROM items").fetchall()

    matches = [
        match
        for match in build_matches(all_rows)
        if match["lost"]["id"] == item_id or match["found"]["id"] == item_id
    ]
    matches.sort(key=lambda match: -match["score"])

    return (
        jsonify(
            {
                "item": serialize_item(row, include_email=True),
                "match_count": len(matches),
                "matches": matches[:3],
            }
        ),
        201,
    )


@app.get("/api/matches")
def get_matches():
    email = normalize_email(request.args.get("email"))
    item_id_raw = request.args.get("item_id")
    rows = fetch_all_item_rows()
    matches = build_matches(rows)

    if item_id_raw:
        try:
            item_id = int(item_id_raw)
        except ValueError:
            raise ApiError("item_id must be a number.") from None
        matches = [
            match
            for match in matches
            if match["lost"]["id"] == item_id or match["found"]["id"] == item_id
        ]

    if email:
        for match in matches:
            match["involves_me"] = email in {
                match["lost"]["reporter_email"].lower(),
                match["found"]["reporter_email"].lower(),
            }
        matches.sort(
            key=lambda match: (
                not match.get("involves_me", False),
                -match["score"],
                match["lost"]["created_at"],
            )
        )
    else:
        for match in matches:
            match["involves_me"] = False

    return jsonify(
        {
            "matches": matches,
            "count": len(matches),
            "my_count": sum(1 for match in matches if match["involves_me"]),
        }
    )


@app.get("/api/stats")
def stats():
    rows = fetch_all_item_rows()
    lost = sum(1 for row in rows if row["status"] == "lost")
    found = len(rows) - lost
    matches = build_matches(rows)
    locations = len({row["location"] for row in rows})
    latest = rows[0]["created_at"] if rows else None
    return jsonify(
        {
            "total": len(rows),
            "lost": lost,
            "found": found,
            "locations": locations,
            "matches": len(matches),
            "latest": latest,
        }
    )


@app.errorhandler(ApiError)
def handle_api_error(error: ApiError):
    return jsonify({"error": error.message}), error.status


@app.errorhandler(413)
def handle_too_large(error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "That upload is too large. Please use a photo under 3 MB."}), 413
    return "Upload too large", 413


@app.errorhandler(404)
def handle_404(error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "That endpoint does not exist."}), 404
    return render_template("index.html"), 404


@app.after_request
def add_cache_headers(response):
    if request.path == "/" or request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5057")), debug=False)
