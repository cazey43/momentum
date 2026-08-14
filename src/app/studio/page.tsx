import { PRECEDENCE } from '@/server/skills/precedence'
import { scanAllSkills } from '@/server/skills/scan'
import { SKILL_TEMPLATES } from '@/server/skills/templates'
import { StudioApp } from './StudioApp'

export const metadata = { title: 'Skills Studio' }
export const dynamic = 'force-dynamic'

export default async function StudioPage() {
  const inventory = await scanAllSkills(process.cwd())

  return (
    <StudioApp
      skills={inventory.skills}
      conflicts={inventory.conflicts}
      scopes={inventory.scopes}
      templates={SKILL_TEMPLATES.map((t) => ({
        slug: t.slug,
        title: t.title,
        category: t.category,
        summary: t.summary,
        useCases: t.useCases,
        frontmatter: t.frontmatter,
        body: t.body,
      }))}
      precedence={[...PRECEDENCE]}
    />
  )
}
