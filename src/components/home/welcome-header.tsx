'use client';

import { motion } from 'framer-motion';

export function WelcomeHeader() {
  return (
    <div className="mb-8">
      <motion.h1
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-3xl font-bold tracking-tight text-foreground"
      >
        Project OS
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-2 text-muted-foreground"
      >
        Manage your ideas, tasks, and progress in one place.
      </motion.p>
    </div>
  );
}

