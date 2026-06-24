import { getAudienceLabel } from '../../utils/catalogFormat'

type AudienceBadgeProps = {
  audience: string | null | undefined
}

function AudienceBadge({ audience }: AudienceBadgeProps) {
  const label = getAudienceLabel(audience) || 'Unisex'

  return <span className="catalog-audience-badge">{label}</span>
}

export default AudienceBadge
