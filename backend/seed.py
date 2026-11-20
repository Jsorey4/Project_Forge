"""
@author: Aashwat Singh (test accounts); demo team data: eLeet Coderz (Team 3)
@description: Command-line seed for ProjectForge. It fills the database with the demo team and the four
    documented test accounts (owner@, manager@, member@ and outsider@projectforge.dev) so every use case
    can be tried by hand. Without options it only adds what is missing. With --reset it first wipes the
    local SQLite demo database (every table) and rebuilds it from scratch, which is the quickest way back
    to a clean state after trying invitations, role changes or deletions. It refuses --reset on PostgreSQL.
    Run from the backend folder:   python seed.py --reset
@traces: UC-01..UC-22 (demo data), SE-FR-01..SE-FR-30
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed the ProjectForge database with demo data and test accounts.")
    parser.add_argument("--reset", action="store_true", help="drop and recreate every table first (SQLite demo database only)")
    args = parser.parse_args(argv)

    from app.core.config import get_settings
    from app.core.database import Base, SessionLocal, create_all, database_kind, engine
    from app.seed import TEST_ACCOUNTS, seed_demo_data, seed_test_accounts

    settings = get_settings()
    if args.reset:
        if database_kind() != "sqlite":
            print("Refusing --reset: this database is PostgreSQL. Reset it in the Supabase dashboard instead.", file=sys.stderr)
            return 2
        from app.models import entities  # noqa: F401  (register every table)

        Base.metadata.drop_all(bind=engine)
        print("Dropped every table in the SQLite demo database.")
    create_all()
    with SessionLocal() as db:
        demo_added = seed_demo_data(db)
        added = seed_test_accounts(db)
    print(f"Demo team: {'seeded' if demo_added else 'already present'}. "
          f"Test accounts: {added['users']} new user(s), {added['projects']} new project(s).")
    print()
    print(f"Database: {database_kind()}   Password for every account: {settings.demo_password}")
    print(f"2FA code (demo mode):      {settings.demo_mfa_code}")
    print()
    print(f"{'Email':28} {'Username':10} Purpose")
    for username, email, _display, purpose in TEST_ACCOUNTS:
        print(f"{email:28} {username:10} {purpose}")
    print()
    print("Older demo accounts (jon, tyler, staff, ...@example.com) use the same password.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
