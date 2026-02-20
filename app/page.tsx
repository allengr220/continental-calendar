import Link from "next/link";
import DateJump from "@/components/DateJump";
import Flourish from "@/components/Flourish";
import {
  clampToProject,
  formatIsoHuman,
  isoToRoute,
  loadDayData,
  todayMappedIso,
  PROJECT_START,
  PROJECT_END,
} from "@/lib/calendar";

type Entry = {
  title?: string;
  quote?: string;
  citation?: string;
  source_url?: string;
  context?: string;
};

function pickHeadline(e: Entry) {
  return (e.quote?.trim() || e.title?.trim() || "").slice(0, 220);
}

export default function Home() {
  const mapped = clampToProject(todayMappedIso());
  const data =
    (loadDayData(mapped) as any) ??
    (loadDayData(PROJECT_START) as any);

  const featuredIso = data?.date ?? PROJECT_START;

  const soldiers: Entry[] = Array.isArray(data?.soldiers_day) ? data.soldiers_day : [];
  const topSoldier = soldiers[0];

  return (
    <article className="parchment-sheet">
      <h1 className="date-title">Continental Calendar</h1>
      <Flourish />

      <p className="context" style={{ textAlign: "center" }}>
        A republican moral ledger centered on the common soldier.
      </p>

      <p className="citation" style={{ textAlign: "center" }}>
        Coverage: {PROJECT_START} → {PROJECT_END}
      </p>

      <div className="flex flex-wrap justify-center gap-2 mt-4">
        <Link className="px-3 py-2 border rounded-md" href={isoToRoute(PROJECT_START)}>
          Start
        </Link>
        <Link className="px-3 py-2 border rounded-md" href={isoToRoute(PROJECT_END)}>
          End
        </Link>
        <DateJump min={PROJECT_START} max={PROJECT_END} />
      </div>

      <div className="rule" />

      <div className="section-label">Featured Day</div>
      <p className="quote" style={{ textAlign: "center" }}>
        {formatIsoHuman(featuredIso)}
      </p>
      <p className="citation" style={{ textAlign: "center" }}>
        {featuredIso}
      </p>

      <div className="flex justify-center mt-3">
        <Link className="px-3 py-2 border rounded-md" href={isoToRoute(featuredIso)}>
          Open day
        </Link>
      </div>

      <div className="rule" />

      <div className="section-label">The Soldier’s Day (Preview)</div>

      {topSoldier ? (
        <>
          <p className="quote" style={{ textAlign: "center" }}>
            “{pickHeadline(topSoldier)}”
          </p>
          {topSoldier.citation ? (
            <p className="citation" style={{ textAlign: "center" }}>
              {topSoldier.citation}
            </p>
          ) : null}
          {topSoldier.context ? (
            <p className="context" style={{ textAlign: "center" }}>
              {topSoldier.context}
            </p>
          ) : null}
        </>
      ) : (
        <p className="context" style={{ textAlign: "center" }}>
          Curation required: add at least one entry to <code>soldiers_day</code> for {featuredIso}.
        </p>
      )}
    </article>
  );
}