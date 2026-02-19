import fs from "fs";
import path from "path";

type Params = { year: string; month: string; day: string };

function getDayData(year: string, month: string, day: string) {
  const fileName = `${year}-${month}-${day}.json`;
  const filePath = path.join(process.cwd(), "data", fileName);

  if (!fs.existsSync(filePath)) return null;

  const fileContents = fs.readFileSync(filePath, "utf8");
  return JSON.parse(fileContents);
}

export default function DayPage({ params }: { params: Params }) {
  const { year, month, day } = params;
  const data = getDayData(year, month, day);

  if (!data) {
    return (
      <main className="p-6 max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold">
          No entry found for {year}-{month}-{day}
        </h1>
      </main>
    );
  }

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-8">
      <h1 className="text-3xl font-bold">
        {year}-{month}-{day}
      </h1>

      <Section title="Continental Congress" items={data.continental_congress} />
      <Section title="Battles" items={data.battles} />
      <Section title="Letters & Deeds" items={data.letters_and_deeds} />
    </main>
  );
}

function Section({ title, items }: { title: string; items: any[] }) {
  return (
    <section>
      <h2 className="text-xl font-semibold mb-3">{title}</h2>
      <div className="space-y-4">
        {items.map((item, idx) => (
          <div key={idx} className="border rounded-lg p-4">
            <h3 className="font-medium">{item.title}</h3>
            <p className="text-sm opacity-80 mt-1">{item.summary}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
