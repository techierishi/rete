import { Component } from './component';
import { Connection } from './connection';
import { Context } from './core/context';
import { EditorEvents } from './events';
import { EditorView } from './view/index';
import { Input } from './input';
import { Node } from './node';
import { Output } from './output';
import { Selected } from './selected';
import { Validator } from './core/validator';
import { Data } from './core/data';
import { EventsTypes } from './events';

export class NodeEditor extends Context<EventsTypes> {

    nodes: Node[] = [];
    selected = new Selected();
    view: EditorView;

    constructor(id: string, container: HTMLElement) {
        super(id, new EditorEvents());
        
        this.view = new EditorView(container, this.components, this);

        window.addEventListener('keydown', e => this.trigger('keydown', e));
        window.addEventListener('keyup', e => this.trigger('keyup', e));
        this.on('selectnode', ({ node, accumulate }) => this.selectNode(node, accumulate));
        this.on('nodeselected', () => this.selected.each(n => {
            const nodeView = this.view.nodes.get(n);

            nodeView && nodeView.onStart()
        }));
        this.on('translatenode', ({ dx, dy }) => this.selected.each(n => {
            const nodeView = this.view.nodes.get(n);

            nodeView && nodeView.onDrag(dx, dy)
        }));
    }

    addNode(node: Node) {
        if (!this.trigger('nodecreate', node)) return;

        this.nodes.push(node);
        this.view.addNode(node);
        
        this.trigger('nodecreated', node);
    }

    removeNode(node: Node) {
        if (!this.trigger('noderemove', node)) return;

        node.getConnections().forEach(c => this.removeConnection(c));

        this.nodes.splice(this.nodes.indexOf(node), 1);
        this.view.removeNode(node);

        this.trigger('noderemoved', node);
    }

    connect(output: Output, input: Input, data = {}) {
        if (!this.trigger('connectioncreate', { output, input })) return;

        try {
            const connection = output.connectTo(input);

            connection.data = data;
            this.view.addConnection(connection);

            this.trigger('connectioncreated', connection);
        } catch (e) {
            this.trigger('warn', e)
        }
    }

    removeConnection(connection: Connection) {
        if (!this.trigger('connectionremove', connection)) return;
            
        this.view.removeConnection(connection);
        connection.remove();

        this.trigger('connectionremoved', connection);
    }

    selectNode(node: Node, accumulate: boolean = false) {
        if (this.nodes.indexOf(node) === -1) 
            throw new Error('Node not exist in list');
        
        if (!this.trigger('nodeselect', node)) return;

        this.selected.add(node, accumulate);
        
        this.trigger('nodeselected', node);
    }

    getComponent(name: string) {
        const component = this.components.get(name);

        if (!component)
            throw `Component ${name} not found`;
        
        return component as Component;
    }

    register(component: Component) {
        super.register(component)
        component.editor = this;
    }

    clear() {
        [...this.nodes].map(node => this.removeNode(node));
    }

    toJSON() {
        const data: Data = { id: this.id, nodes: {} };
        
        this.nodes.forEach(node => data.nodes[node.id] = node.toJSON());
        this.trigger('export', data);
        return data;
    }

    beforeImport(json: Data) {
        const checking = Validator.validate(this.id, json);
        
        if (!checking.success) {
            this.trigger('warn', checking.msg);
            return false;
        }
        
        this.silent = true;
        this.clear();
        this.trigger('import', json);
        return true;
    }

    afterImport() {
        this.silent = false;
        return true;
    }

    async fromJSON(json: Data) {
        if (!this.beforeImport(json)) return false;
        const nodes: any = {};

        try {
            await Promise.all(Object.keys(json.nodes).map(async id => {
                const node = json.nodes[id];
                const component = this.getComponent(node.name);

                nodes[id] = await component.build(Node.fromJSON(node));
                this.addNode(nodes[id]);
            }));
        
            Object.keys(json.nodes).forEach(id => {
                const jsonNode = json.nodes[id];
                const node = nodes[id];
                
                Object.keys(jsonNode.outputs).forEach(key => {
                    const outputJson = jsonNode.outputs[key];
                    console.log("techierishi outputJson",outputJson)
                    outputJson.connections.forEach(jsonConnection => {
                        const nodeId = jsonConnection.node;
                        const data = jsonConnection.data;
                        const targetOutput = node.outputs.get(key);
                        const targetInput = nodes[nodeId].inputs.get(jsonConnection.input);

                        this.connect(targetOutput, targetInput, data);
                    });
                });

            });
        }
        catch (e) {
            this.trigger('warn', e);
            return !this.afterImport();
        } finally {
            return this.afterImport();
        }
    }
}
