import argparse
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.services.podcast.covers import generate_covers_for_job


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate podcast cover images from rendered clips.")
    parser.add_argument("job_id", help="Podcast job id")
    parser.add_argument("--frame-ratio", type=float, default=0.35, help="Frame position in clip duration, 0-1")
    parser.add_argument("--variants", type=int, default=3, help="Number of cover options per clip")
    args = parser.parse_args()

    generated = generate_covers_for_job(args.job_id, variants=args.variants, frame_ratio=args.frame_ratio)
    for path in generated:
        print(path)


if __name__ == "__main__":
    main()
