'use client';

/** How it works: fortitudo's four-step spotlight grid, carrying Koala's
 *  real flow: connect, let Koala work, approve, stay current. */

import { motion } from 'motion/react';
import { SpotlightCard } from '../spotlight-card';

const steps = [
  {
    title: 'List your services',
    description:
      'Add what you offer, connect your inbox and calendar, and your storefront goes live in the marketplace. Two minutes, no migration.',
  },
  {
    title: 'Koala works',
    description:
      'It replies to inquiries in your voice, scores each new client against your bookings, and surfaces the one to handle first.',
  },
  {
    title: 'You approve',
    description:
      "Read the reply, edit it, send it. Or don't. By default every move is yours to approve. Nothing leaves without your name on it.",
  },
  {
    title: 'Stay booked',
    description:
      'Sessions land on the calendar, your schedule updates itself, and every client touch is logged. The board reflects reality, not last week.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative scroll-mt-24 bg-background py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-brand text-xs uppercase tracking-[0.25em] text-brand">How it works</p>
          <h2 className="font-brand mt-3 text-3xl text-foreground sm:text-4xl lg:text-5xl">
            From inquiry to <span className="text-gradient-brand">booked.</span>
          </h2>
          <p className="mt-4 text-lg text-foreground/60">
            A calm, transparent flow that keeps you in control the whole way through.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.08 }}
              className="h-full"
            >
              <SpotlightCard className="h-full p-6">
                <span className="font-brand text-3xl tabular-nums text-brand">0{index + 1}</span>
                <h3 className="font-brand mt-3 text-xl text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              </SpotlightCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
