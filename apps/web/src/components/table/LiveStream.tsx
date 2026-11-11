type Props = { src: string; tableName: string; className?: string };

/**
 * A manual table's live webcam (migration 032): the YouTube or Twitch player, muted so it can start
 * by itself. `src` comes from streamEmbedUrl (@preflop/client), which builds it from the stream id,
 * and the CSP lets the page frame those two players only.
 */
export function LiveStream({ src, tableName, className }: Props) {
  return (
    <div className={className}>
      <iframe
        src={src}
        title={`Live stream of ${tableName}`}
        className="h-full w-full border-0 bg-black"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation"
      />
    </div>
  );
}
