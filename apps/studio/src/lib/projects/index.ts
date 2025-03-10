import { MainChannels } from '@onlook/models/constants';
import type { Project } from '@onlook/models/projects';
import type { AppState, ProjectsCache } from '@onlook/models/settings';
import { makeAutoObservable } from 'mobx';
import { nanoid } from 'nanoid/non-secure';
import type { EditorEngine } from '../editor/engine';
import { invokeMainChannel, sendAnalytics } from '../utils';
import { CreateManager } from './create';
import { HostingManager } from './hosting';
import { RunManager } from './run';

export enum ProjectTabs {
    PROJECTS = 'projects',
    SETTINGS = 'settings',
    PROMPT_CREATE = 'prompt-create',
    IMPORT_PROJECT = 'import-project',
}

export class ProjectsManager {
    projectsTab: ProjectTabs = ProjectTabs.PROJECTS;
    editorEngine: EditorEngine | null = null;

    private createManager: CreateManager;
    private activeProject: Project | null = null;
    private activeRunManager: RunManager | null = null;
    private activeHostingManager: HostingManager | null = null;
    private projectList: Project[] = [];

    constructor() {
        makeAutoObservable(this);
        this.createManager = new CreateManager(this);
        this.restoreProjects();
    }

    get create() {
        return this.createManager;
    }

    async restoreProjects() {
        const cachedProjects: ProjectsCache | null = await invokeMainChannel(
            MainChannels.GET_PROJECTS,
        );
        if (!cachedProjects || !cachedProjects.projects) {
            console.error('Failed to restore projects');
            return;
        }
        this.projectList = cachedProjects.projects;

        const appState: AppState | null = await invokeMainChannel(MainChannels.GET_APP_STATE);
        if (!appState) {
            console.error('Failed to restore app state');
            return;
        }
        if (appState.activeProjectId) {
            this.project = this.projectList.find((p) => p.id === appState.activeProjectId) || null;
        }
    }

    createProject(
        name: string,
        url: string,
        folderPath: string,
        commands: {
            install: string;
            run: string;
            build: string;
        },
    ): Project {
        const newProject: Project = {
            id: nanoid(),
            name,
            url,
            folderPath,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            commands,
            previewImg: null,
            settings: null,
            hosting: null,
        };

        const updatedProjects = [...this.projectList, newProject];
        this.projects = updatedProjects;
        return newProject;
    }

    updateProject(project: Project) {
        const updatedProjects = this.projectList.map((p) => (p.id === project.id ? project : p));
        if (project.id === this.project?.id) {
            this.project = project;
        }
        this.projects = updatedProjects;
    }

    updateAppState(appState: AppState) {
        invokeMainChannel(MainChannels.REPLACE_APP_STATE, appState);
    }

    saveProjects() {
        invokeMainChannel(MainChannels.UPDATE_PROJECTS, { projects: this.projectList });
    }

    deleteProject(project: Project, deleteProjectFolder: boolean = false) {
        if (this.project?.id === project.id) {
            this.project = null;
        }
        this.projects = this.projectList.filter((p) => p.id !== project.id);

        if (deleteProjectFolder) {
            invokeMainChannel(MainChannels.DELETE_FOLDER, project.folderPath);
        }
        sendAnalytics('delete project', { url: project.url, id: project.id, deleteProjectFolder });
    }

    get project() {
        return this.activeProject;
    }

    get runner(): RunManager | null {
        return this.activeRunManager;
    }

    get hosting(): HostingManager | null {
        return this.activeHostingManager;
    }

    set project(newProject: Project | null) {
        if (!newProject) {
            this.disposeManagers();
        } else if (newProject.id !== this.activeProject?.id) {
            this.disposeManagers();
            this.setManagers(newProject);
        }

        this.activeProject = newProject;
        this.updateAppState({
            activeProjectId: this.project?.id ?? null,
        });
    }

    setManagers(project: Project) {
        if (!this.editorEngine) {
            console.error('Editor engine not found');
            return;
        }
        this.activeRunManager = new RunManager(project, this.editorEngine);
        this.activeHostingManager = new HostingManager(this, project);
    }

    disposeManagers() {
        this.activeRunManager?.dispose();
        this.activeHostingManager?.dispose();
        this.activeRunManager = null;
        this.activeHostingManager = null;
    }

    get projects() {
        return this.projectList;
    }

    set projects(newProjects: Project[]) {
        this.projectList = newProjects;
        this.saveProjects();
    }
}
