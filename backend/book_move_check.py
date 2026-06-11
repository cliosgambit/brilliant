import json
import sys


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "moves_json is required"}))
        return 1

    try:
        moves = json.loads(sys.argv[1])
    except Exception as e:
        print(json.dumps({"error": f"Invalid moves JSON: {e}"}))
        return 1

    if not isinstance(moves, list):
        print(json.dumps({"error": "moves must be an array"}))
        return 1

    san_moves = [str(m).strip() for m in moves if str(m).strip()]
    if len(san_moves) == 0:
        print(json.dumps({"is_book_move": True, "next_book_moves": [], "opening": None}))
        return 0

    try:
        from Openix import ChessOpeningsLibrary
    except Exception as e:
        print(json.dumps({"error": f"Openix import failed: {e}", "is_book_move": False, "next_book_moves": []}))
        return 0

    try:
        lib = ChessOpeningsLibrary()
        lib.load_builtin_openings()

        # A move is considered "book" if at least one opening line matches this prefix.
        opening_matches = lib.find_openings_after_moves(san_moves)
        is_book = len(opening_matches) > 0

        next_book_moves = []
        if is_book:
            try:
                next_moves = lib.list_next_moves_after(san_moves)
                if isinstance(next_moves, list):
                    next_book_moves = [str(m) for m in next_moves][:20]
            except Exception:
                next_book_moves = []

        opening_name = None
        eco_code = None
        if is_book and opening_matches:
            opening = opening_matches[0]
            opening_name = getattr(opening, "name", None)
            eco_code = getattr(opening, "eco_code", None)

        print(json.dumps({
            "is_book_move": is_book,
            "opening": {
                "eco": eco_code,
                "name": opening_name
            } if opening_name or eco_code else None,
            "next_book_moves": next_book_moves,
        }))
        return 0
    except Exception as e:
        print(json.dumps({"error": f"Openix lookup failed: {e}", "is_book_move": False, "next_book_moves": []}))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
