import { parseISO } from 'date-fns'
import { z } from 'zod'

const ISO8601DateString = z.string().refine(
  (arg): boolean => {
    if (parseISO(arg).toString() === 'Invalid Date') {
      return false
    }

    return true
  },
  { message: `Value is not a valid date` }
)

const DBTimestamps = z.object({
  created_at: ISO8601DateString,
  updated_at: ISO8601DateString
})

// A user that has not been inserted into the database
export const UserBase = z.object({
  first_name: z.string(),
  last_name: z.string(),
  email: z.string(),
  activated: z.boolean(),
  // id: z.string()
})

export type UserBase = z.TypeOf<typeof UserBase>

// A user from the database
export const User = z
  .object({
    // id: z.string()
  })
  .merge(UserBase)
  .merge(DBTimestamps)

export type User = z.TypeOf<typeof User>
