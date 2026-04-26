export default function Offline(): JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 text-center">
      <div>
        <h1 className="font-heading text-4xl text-gold-bright">No signal out here.</h1>
        <p className="mt-3 opacity-80">
          You&apos;re offline. Stuff you&apos;ve already loaded should still work — pull back when
          you&apos;ve got bars.
        </p>
      </div>
    </div>
  );
}
