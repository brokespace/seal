import { createContext } from 'react'
import type { HomeOverviewProviders } from './home-overview-model'
import { sealHomeOverviewProviders } from './seal-home-overview-providers'

/** Wrap Home in a provider with another implementation to swap data sources (registries, fixtures). */
export const HomeOverviewProvidersContext =
  createContext<HomeOverviewProviders>(sealHomeOverviewProviders)
