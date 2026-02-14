import Link from "next/link";
import { Card } from "@/components/ui/card";
import { FileText, Plus, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { getRecentNotes } from "@/lib/home/actions";
import { brand } from "@/lib/brand";

export async function RecentNotes() {
  const notes = await getRecentNotes();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">{brand.terms.library}</h2>
        <Button variant="ghost" size="icon" asChild>
          <Link href="/notes">
            <MoreHorizontal className="h-4 w-4" />
          </Link>
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {notes.map((note) => (
          <Link href={`/notes?id=${note.id}`} key={note.id}>
            <Card className="h-full hover:bg-secondary/5 transition-colors cursor-pointer p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="p-2 bg-orange-100 dark:bg-orange-900/20 rounded-lg">
                  <FileText className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-sm line-clamp-1">{note.title}</h3>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {note.content?.slice(0, 100) || "Empty note"}
                </p>
              </div>
              <div className="text-[10px] text-muted-foreground pt-2">
                {formatDistanceToNow(note.updatedAt, { addSuffix: true })}
              </div>
            </Card>
          </Link>
        ))}
        <Link href="/notes">
          <Card className="h-full border-dashed flex flex-col items-center justify-center p-4 hover:bg-secondary/5 transition-colors cursor-pointer text-muted-foreground hover:text-primary min-h-[140px]">
            <Plus className="h-6 w-6 mb-2" />
            <span className="text-sm font-medium">Capture note</span>
          </Card>
        </Link>
      </div>
    </div>
  );
}
