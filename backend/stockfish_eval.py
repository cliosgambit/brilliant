
import sys
import json
import subprocess
import os

import os

# Dynamic path to Stockfish executable
STOCKFISH_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'stockfish', 'stockfish-windows-x86-64-avx2.exe'))

def get_stockfish_eval(fen):
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
            f'position fen {fen}',
            'go depth 1'
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

        eval_line = None
        while True:
            line = proc.stdout.readline().strip()
            if line.startswith('bestmove'):
                break
            if 'score cp' in line:
                eval_line = line
        
        proc.stdin.write('quit\n')
        proc.stdin.flush()

        if not eval_line:
            return {"error": "no_evaluation"}

        return {"evaluation": eval_line}

    except Exception as e:
        return {"error": "exception", "detail": str(e)}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing fen"}))
        sys.exit(1)
    
    fen = sys.argv[1]

    result = get_stockfish_eval(fen)
    
    print(json.dumps(result))
    sys.exit(0)

if __name__ == '__main__':
    main()
