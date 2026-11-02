export interface SourceTask {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface TaskPage {
  items: SourceTask[];
  next_cursor: string | null;
}

export interface SourceProject {
  id: string;
  name: string;
  description: string;
  item_count: number;
}
