const isProduction = process.env.NODE_ENV === 'production'
const frontendUrl = process.env.FRONTEND_URL?.trim()
const adminFrontendUrl = process.env.ADMIN_FRONTEND_URL?.trim()
const localOrigins = isProduction ? [] : ['http://localhost:5173', 'http://localhost:3000']

export const allowedOrigins = new Set(
  [frontendUrl, adminFrontendUrl, ...localOrigins].filter(
    (origin): origin is string => Boolean(origin),
  ),
)

function validateProductionEnv() {
  if (!isProduction) {
    return
  }

  const missingEnvVars = ['FRONTEND_URL', 'DATABASE_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'].filter(
    (key) => !process.env[key]?.trim(),
  )

  if (missingEnvVars.length) {
    throw new Error(
      `[security] Missing required production environment variables: ${missingEnvVars.join(', ')}`,
    )
  }
}

validateProductionEnv()
