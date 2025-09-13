export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

export interface ProjectCacheData {
  id: string;
  name: string;
  provider: string;
  description?: string;
  url?: string;
  members?: UserRole[];
}

export interface UserRole {
  userId: string;
  username: string;
  displayName: string;
  email?: string;
  role: string; // maintainer, developer, reporter, etc.
  accessLevel?: number;
}

export interface ProviderUserCache {
  provider: string;
  users: Map<string, UserRole>;
  lastUpdated: number;
}

/**
 * Centralized cache manager for Project Nexus
 * Handles caching of projects, users, and their roles with TTL support
 */
export class CacheManager {
  private projectsCache: Map<string, CacheEntry<ProjectCacheData[]>> = new Map();
  private usersCache: Map<string, CacheEntry<ProviderUserCache>> = new Map();
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private defaultTTL = 15 * 60 * 1000, // 15 minutes default TTL
  ) {}

  /**
   * Store projects data in cache for a specific provider
   */
  setProjects(provider: string, projects: ProjectCacheData[], ttl?: number): void {
    const entry: CacheEntry<ProjectCacheData[]> = {
      data: projects,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTTL,
    };

    this.projectsCache.set(provider, entry);
    this.scheduleRefresh(`projects:${provider}`, entry.ttl);

    process.stderr.write(`[cache] Cached ${projects.length} projects for ${provider}\n`);
  }

  /**
   * Get cached projects for a provider
   */
  getProjects(provider: string): ProjectCacheData[] | null {
    const entry = this.projectsCache.get(provider);

    if (!entry) {
      return null;
    }

    // Check if cache is expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.projectsCache.delete(provider);
      return null;
    }

    return entry.data;
  }

  /**
   * Get all cached projects across all providers
   */
  getAllProjects(): ProjectCacheData[] {
    const allProjects: ProjectCacheData[] = [];

    for (const [provider, entry] of this.projectsCache.entries()) {
      // Check if cache is still valid
      if (Date.now() - entry.timestamp <= entry.ttl) {
        allProjects.push(...entry.data);
      } else {
        // Clean up expired cache
        this.projectsCache.delete(provider);
      }
    }

    return allProjects;
  }

  /**
   * Search projects across all cached providers
   */
  searchProjects(query?: string): ProjectCacheData[] {
    const allProjects = this.getAllProjects();

    if (!query) {
      return allProjects;
    }

    const searchTerm = query.toLowerCase();
    return allProjects.filter(
      (project) =>
        project.name.toLowerCase().includes(searchTerm) ||
        project.id.toLowerCase().includes(searchTerm) ||
        project.description?.toLowerCase().includes(searchTerm),
    );
  }

  /**
   * Store users data in cache for a specific provider
   */
  setUsers(provider: string, users: UserRole[], ttl?: number): void {
    const userMap = new Map<string, UserRole>();
    users.forEach((user) => {
      userMap.set(user.userId, user);
    });

    const providerUserCache: ProviderUserCache = {
      provider,
      users: userMap,
      lastUpdated: Date.now(),
    };

    const entry: CacheEntry<ProviderUserCache> = {
      data: providerUserCache,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTTL,
    };

    this.usersCache.set(provider, entry);
    this.scheduleRefresh(`users:${provider}`, entry.ttl);

    process.stderr.write(`[cache] Cached ${users.length} users for ${provider}\n`);
  }

  /**
   * Get cached users for a provider
   */
  getUsers(provider: string): UserRole[] | null {
    const entry = this.usersCache.get(provider);

    if (!entry) {
      return null;
    }

    // Check if cache is expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.usersCache.delete(provider);
      return null;
    }

    return Array.from(entry.data.users.values());
  }

  /**
   * Get all cached users across all providers
   */
  getAllUsers(): UserRole[] {
    const allUsers: UserRole[] = [];

    for (const [provider, entry] of this.usersCache.entries()) {
      // Check if cache is still valid
      if (Date.now() - entry.timestamp <= entry.ttl) {
        allUsers.push(...Array.from(entry.data.users.values()));
      } else {
        // Clean up expired cache
        this.usersCache.delete(provider);
      }
    }

    return allUsers;
  }

  /**
   * Search users across all cached providers
   */
  searchUsers(query?: string): UserRole[] {
    const allUsers = this.getAllUsers();

    if (!query) {
      return allUsers;
    }

    const searchTerm = query.toLowerCase();
    return allUsers.filter(
      (user) =>
        user.username.toLowerCase().includes(searchTerm) ||
        user.displayName.toLowerCase().includes(searchTerm) ||
        user.email?.toLowerCase().includes(searchTerm),
    );
  }

  /**
   * Get users for a specific project (from project members cache)
   */
  getProjectUsers(projectId: string): UserRole[] {
    const allProjects = this.getAllProjects();
    const project = allProjects.find((p) => p.id === projectId);

    return project?.members ?? [];
  }

  /**
   * Schedule cache refresh
   */
  private scheduleRefresh(key: string, ttl: number): void {
    // Clear existing timer if any
    const existingTimer = this.refreshTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new refresh timer
    const timer = setTimeout(() => {
      process.stderr.write(`[cache] Cache expired for ${key}, needs refresh\n`);
      this.refreshTimers.delete(key);

      // Emit refresh event (will be handled by the cache warming system)
      this.onCacheExpired?.(key);
    }, ttl);

    this.refreshTimers.set(key, timer);
  }

  /**
   * Callback for when cache expires - can be overridden to trigger refresh
   */
  public onCacheExpired?: (cacheKey: string) => void;

  /**
   * Check if cache is available for a provider
   */
  hasValidCache(provider: string, type: 'projects' | 'users'): boolean {
    if (type === 'projects') {
      const entry = this.projectsCache.get(provider);
      return entry !== undefined && Date.now() - entry.timestamp <= entry.ttl;
    } else {
      const entry = this.usersCache.get(provider);
      return entry !== undefined && Date.now() - entry.timestamp <= entry.ttl;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    projects: { provider: string; count: number; age: number; ttl: number }[];
    users: { provider: string; count: number; age: number; ttl: number }[];
  } {
    const now = Date.now();

    const projects = Array.from(this.projectsCache.entries()).map(([provider, entry]) => ({
      provider,
      count: entry.data.length,
      age: now - entry.timestamp,
      ttl: entry.ttl,
    }));

    const users = Array.from(this.usersCache.entries()).map(([provider, entry]) => ({
      provider,
      count: entry.data.users.size,
      age: now - entry.timestamp,
      ttl: entry.ttl,
    }));

    return { projects, users };
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.projectsCache.clear();
    this.usersCache.clear();

    // Clear all timers
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();

    process.stderr.write('[cache] All caches cleared\n');
  }

  /**
   * Graceful shutdown - clear all timers
   */
  shutdown(): void {
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
    process.stderr.write('[cache] Cache manager shut down\n');
  }
}
