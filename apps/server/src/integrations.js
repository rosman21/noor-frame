// The integrations this server ships with. To add one, install or write it under
// packages/integrations/<name> and add it to this list (see docs/writing-an-integration.md).

import { builtins } from '@noor-frame/core';
import prayer from '@noor-frame/prayer-aladhan';
import weather from '@noor-frame/weather-open-meteo';
import quran from '@noor-frame/quran-alquran-cloud';
import calendar from '@noor-frame/calendar-ics';
import travel from '@noor-frame/travel';
import ai from '@noor-frame/ai-claude';

export const defaultIntegrations = [...builtins, prayer, weather, quran, calendar, travel, ai];
