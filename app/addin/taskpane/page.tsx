import { TaskPane } from '@/components/taskpane'

export const metadata = { title: 'Task pane' }
export const dynamic = 'force-dynamic'

export default function TaskPanePage() {
  return <TaskPane />
}
