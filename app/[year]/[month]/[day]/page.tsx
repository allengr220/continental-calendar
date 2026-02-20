import Link from "next/link";
import DateJump from "@/components/DateJump";
import Flourish from "@/components/Flourish";
import {
  addDays,
  clampToProject,
  formatIsoHuman,
  isoToRoute,
  loadDayData,
  PROJECT_END,
  PROJECT_START,
} from "@/lib/calendar";

type Params = { year: string; month: string; day: string };

type Facsimile = { src: string; caption?: string };

type Entry = {
  title?: string;
  quote?: string;
  citation?: string;
  source_url?: string;
  context?: string;
  facsimiles?: Facsimile[];
};

function clampEntries(items: Entry[] | undefined, cap: number): Entry[] {
  if (!items || !Array.isArray(items)) return [];
  return items.slice(0, cap);
}

function EntryBlock({ entry }: { entry: Entry }) {
  const headline = entry.quote?.trim() || entry.title?.trim() || "";
  const hasFacsimile = Boolean(entry.facsimiles && entry.facsimiles.length > 0);
  const firstFac = hasFacsimile ? entry.facsimiles![0] : null;

  // If we have a facsimile, use the inline-grid layout at desktop.
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    hasFacsimile ? <div className="inline-grid">{children}</div> : <>{children}</>;

  return (
    <div>
      <Wrapper>
        <div>
          {headline ? <p className="quote">“{headline}”</p> : null}

          {entry.citation ? (
            entry.source_url ? (
              <p className="citation">
                <a className="underline" href={entry.source_url} target="_blank" rel="noreferrer">
                  {entry.citation}
                </a>
              </p>
            ) : (
              <p className="citation">{entry.citation}</p>
            )
          ) : null}

          {entry.context ? <p className="context">{entry.context}</p> : null}
        </div>

        {firstFac ? (
          <figure className="facsimile">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={firstFac.src} alt={firstFac.caption || "Facsimile"} />
            {firstFac.caption ? <figcaption className="caption">{firstFac.caption}</figcaption> : null}
          </figure>
        ) : null}
      </Wrapper>
    </div>
  );
}

function Section({
  label,
  items,
  cap,
  emptyText = "No entries yet.",
}: {
  label: string;
  items: Entry[] | undefined;
  cap: number;
  emptyText?: string;
}) {
  const list = clampEntries(items, cap);

  return (
    <section>
      <div className="section-label">{label}</div>

      {list.length === 0 ? (
        <p className="context">{emptyText}</p>
      ) : (
        <>
          {list.map((entry, idx) => (
            <div key={idx}>
              <EntryBlock entry={entry} />
              {idx !== list.length - 1 ? <div className="rule" /> : null}
            </div>
          ))}
        </>
      )}
    </section>
  );
}

export default async function DayPage({ params }: { params: Promise<Params> }) {
  const { year, month, day } = await params;

  const iso = `${year}-${month}-${day}`;
  const clamped = clampToProject(iso);

  if (clamped !== iso) {
    return (
      <article className="parchment-sheet">
        <h1 className="date-title">Out of range</h1>
        <Flourish />
        <p className="context">
          This project covers {PROJECT_START} through {PROJECT_END}.
        </p>
        <Link className="context underline" href={isoToRoute(clamped)}>
          Go to {clamped}
        </Link>
      </article>
    );
  }

  const data = loadDayData(iso) as
    | null
    | {
        date: string;
        soldiers_day?: Entry[];
        men_of_command?: Entry[];
        continental_congress_committees?: Entry[];
        voices_beyond_the_line?: Entry[];
      };

  const prevIso = clampToProject(addDays(iso, -1));
  const nextIso = clampToProject(addDays(iso, +1));
  const prevDisabled = iso === PROJECT_START;
  const nextDisabled = iso === PROJECT_END;

  const soldiers = data?.soldiers_day ?? [];
  const command = data?.men_of_command ?? [];
  const congress = data?.continental_congress_committees ?? [];
  const voices = data?.voices_beyond_the_line ?? [];

  const soldiersMissing = Boolean(data) && soldiers.length === 0;

  return (
    <article className="parchment-sheet">
      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex gap-2">
          {prevDisabled ? (
            <span className="px-3 py-2 border rounded-md opacity-50 cursor-not-allowed">← Previous</span>
          ) : (
            <Link className="px-3 py-2 border rounded-md" href={isoToRoute(prevIso)}>
              ← Previous
            </Link>
          )}

          {nextDisabled ? (
            <span className="px-3 py-2 border rounded-md opacity-50 cursor-not-allowed">Next →</span>
          ) : (
            <Link className="px-3 py-2 border rounded-md" href={isoToRoute(nextIso)}>
              Next →
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link className="px-3 py-2 border rounded-md" href="/">
            Home
          </Link>
          <DateJump min={PROJECT_START} max={PROJECT_END} />
        </div>
      </div>

      {/* header */}
      <h1 className="date-title">{formatIsoHuman(iso)}</h1>
      <Flourish />
      <p className="citation" style={{ textAlign: "center" }}>
        {iso}
      </p>

      <div className="rule" />

      {!data ? (
        <p className="context">
          Missing data file: <code>data/{iso}.json</code>
        </p>
      ) : (
        <>
          {soldiersMissing ? (
            <div
              className="cc-warning"
              style={{
                border: "1px solid rgba(42,36,30,.35)",
                background: "rgba(255,255,255,.12)",
                borderRadius: 10,
                padding: 12,
                margin: "16px 0 8px",
              }}
            >
              <p className="context" style={{ margin: 0 }}>
                <strong>Curation required:</strong> <em>The Soldier’s Day</em> must contain at least one entry.
                Do not fabricate—pull a modest but real record (camp, weather, returns, discipline, pay, etc.).
              </p>
            </div>
          ) : null}

          {/* I. Soldier-first */}
          <Section label="The Soldier’s Day" items={soldiers} cap={3} emptyText="Curation required." />
          <div className="rule" />

          {/* II. Command */}
          <Section label="Men of Command" items={command} cap={2} />
          <div className="rule" />

          {/* III. Congress */}
          <Section label="The Continental Congress & Committees" items={congress} cap={2} />

          {/* IV. Voices beyond the line (occasional) */}
          {voices.length > 0 ? (
            <>
              <div className="rule" />
              <Section label="Voices Beyond the Line" items={voices} cap={2} />
            </>
          ) : null}
        </>
      )}
    </article>
  );
}
