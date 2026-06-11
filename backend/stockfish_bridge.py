
import sys
import json
import subprocess
import os

# Dynamic path to Stockfish executable
STOCKFISH_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'stockfish', 'stockfish-windows-x86-64-avx2.exe'))

def get_stockfish_lines(fen, movetime=200):
    if not os.path.exists(STOCKFISH_PATH):
        return {"error": "Stockfish not found", "path": STOCKFISH_PATH}

    try:
        proc = subprocess.Popen(
            [STOCKFISH_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )

        commands = [
            'uci',
            'isready',
            'ucinewgame',
            f'position fen {fen}',
            'setoption name MultiPV value 3',
            f'go movetime {movetime}'
        ]

        for command in commands:
            proc.stdin.write(command + '\n')
            proc.stdin.flush()
            if command == 'uci':
                while 'uciok' not in proc.stdout.readline():
                    pass
            elif command == 'isready':
                while 'readyok' not in proc.stdout.readline():
                    pass

        lines = []
        while True:
            line = proc.stdout.readline().strip()
            if line.startswith('bestmove'):
                break
            if 'multipv' in line:
                lines.append(line)
        
        proc.stdin.write('quit\n')
        proc.stdin.flush()

        return {"lines": lines}

    except Exception as e:
        return {"error": "exception", "detail": str(e)}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing fen"}))
        sys.exit(1)
    
    fen = sys.argv[1]
    movetime = sys.argv[2] if len(sys.argv) > 2 else 200

    result = get_stockfish_lines(fen, movetime)
    
    print(json.dumps(result))
    sys.exit(0)

if __name__ == '__main__':
    main()
