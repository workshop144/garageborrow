import { Link } from "react-router-dom";

export default function NotFound(): JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 text-center">
      <div>
        <h1 className="font-heading text-4xl text-gold-bright">Hmm.</h1>
        <p className="mt-2 opacity-80">Nothing on that peg.</p>
        <Link to="/" className="mt-4 inline-block underline">
          Back to the pegboard
        </Link>
      </div>
    </div>
  );
}
