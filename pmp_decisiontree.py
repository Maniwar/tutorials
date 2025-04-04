import streamlit as st
import graphviz
from io import BytesIO

# Set page configuration for a wide layout
st.set_page_config(layout="wide")

# Title and introductory guidance
st.title("Decision Tree Modeling for PMP Project Managers")
st.markdown("""
This tool helps you create and analyze decision trees for PMP-aligned decision-making.  
- **Start**: Define your entire tree structure below.  
- **Build**: Edit or add nodes using the sidebar.  
- **Analyze**: Compute the optimal path with Expected Monetary Value (EMV).  
Use the sidebar to manage your tree and explore the visualization.
""")

# Initialize tree and computation state
if 'tree' not in st.session_state:
    st.session_state.tree = None
if 'computed' not in st.session_state:
    st.session_state.computed = False
if 'explanation' not in st.session_state:
    st.session_state.explanation = []

# Helper function to get indented node labels for dropdowns with full path
def get_node_paths(node, current_path=[]):
    path_str = " → ".join(current_path + [node['label']])
    yield path_str, node
    if node['type'] != 'end':
        for edge in node.get('edges', []):
            yield from get_node_paths(edge['child'], current_path + [node['label'], edge['label']])

# Helper function to remove a node
def remove_node(node, node_to_remove):
    for edge in node.get('edges', []):
        if edge['child'] is node_to_remove:
            node['edges'].remove(edge)
            return True
        elif remove_node(edge['child'], node_to_remove):
            return True
    return False

# Helper function to get all paths with net values and probabilities
def get_all_paths(node, current_path=[], current_cost=0, current_prob=1.0):
    if node['type'] == 'end':
        net_value = node['payoff'] - current_cost
        return [(current_path, net_value, current_prob)]
    paths = []
    for edge in node['edges']:
        new_path = current_path + [edge['label']]
        if node['type'] == 'decision':
            new_cost = current_cost + edge.get('initial_cost', 0)
            new_prob = current_prob
        elif node['type'] == 'chance':
            new_cost = current_cost
            new_prob = current_prob * edge['probability']
        paths.extend(get_all_paths(edge['child'], new_path, new_cost, new_prob))
    return paths

# Helper function to collect chance node EMVs
def collect_chance_emvs(node, chance_emvs=None):
    if chance_emvs is None:
        chance_emvs = []
    if node['type'] == 'chance' and node.get('value') is not None:
        chance_emvs.append((node['label'], node['value']))
    for edge in node.get('edges') or []:
        collect_chance_emvs(edge['child'], chance_emvs)
    return chance_emvs

# Helper function to generate tree visualization
def generate_tree_image(tree):
    dot = graphviz.Digraph(comment="Decision Tree", graph_attr={'rankdir': 'LR'})
    
    def add_nodes(node, parent_id=None, edge=None, is_optimal=False):
        node_id = str(id(node))
        label = node['label']
        if 'value' in node:
            label += f"\nEMV: {node['value']:.2f}"
        if node['type'] == 'end':
            label += f"\nPayoff: {node['payoff']}"
        shape = 'box' if node['type'] == 'decision' else 'ellipse' if node['type'] == 'chance' else 'diamond'
        dot.node(node_id, label, shape=shape)
        if parent_id and edge:
            if 'initial_cost' in edge:
                edge_label = f"{edge['label']}\nCost: {edge['initial_cost']}"
            elif 'probability' in edge:
                edge_label = f"{edge['label']}\nProb: {edge['probability']*100:.0f}%"
            else:
                edge_label = edge['label']
            edge_style = {'label': edge_label}
            if is_optimal:
                edge_style['color'] = 'red'
                edge_style['penwidth'] = '3'
            dot.edge(parent_id, node_id, **edge_style)
        if node['type'] != 'end':
            for child_edge in node['edges']:
                add_nodes(child_edge['child'], node_id, child_edge, child_edge.get('is_optimal', False))
    
    if tree:
        add_nodes(tree)
        return dot.pipe(format='png')
    return None

# Helper function to compute EMV and optimal path with explanation
def compute_emv(node, current_cost=0, indent=0):
    indent_str = "  " * indent
    if node['type'] == 'end':
        net_value = node['payoff'] - current_cost
        node['value'] = net_value
        explanation = [f"{indent_str}End Node '{node['label']}': Net Value = {node['payoff']} - {current_cost} = {net_value}"]
        return net_value, explanation
    elif node['type'] == 'decision':
        option_emvs = []
        option_explanations = []
        for edge in node['edges']:
            child_emv, child_lines = compute_emv(edge['child'], current_cost + edge.get('initial_cost', 0), indent + 1)
            option_emvs.append(child_emv)
            option_explanations.extend(child_lines)
        max_emv = max(option_emvs) if option_emvs else 0
        node['value'] = max_emv
        explanation = [f"{indent_str}Decision Node '{node['label']}':"]
        for i, emv in enumerate(option_emvs):
            is_opt = "(optimal)" if emv == max_emv else ""
            explanation.append(f"{indent_str}  Option '{node['edges'][i]['label']}': EMV = {emv} {is_opt}")
        explanation.extend(option_explanations)
        for edge, option_emv in zip(node['edges'], option_emvs):
            edge['is_optimal'] = (option_emv == max_emv)
        return max_emv, explanation
    elif node['type'] == 'chance':
        total_prob = sum(edge['probability'] for edge in node['edges'])
        if not (0.99 < total_prob < 1.01):
            raise ValueError(f"Probabilities for chance node '{node['label']}' must sum to 1, got {total_prob:.2f}.")
        child_contributions = []
        child_explanations = []
        for edge in node['edges']:
            child_emv, child_lines = compute_emv(edge['child'], current_cost, indent + 1)
            contribution = edge['probability'] * child_emv
            child_contributions.append(contribution)
            child_explanations.append(f"{indent_str}  Outcome '{edge['label']}': Probability = {edge['probability']}, Child EMV = {child_emv}, Contribution = {edge['probability']} * {child_emv} = {contribution}")
            child_explanations.extend(child_lines)
        expected_emv = sum(child_contributions)
        node['value'] = expected_emv
        explanation = [f"{indent_str}Chance Node '{node['label']}':"]
        explanation.extend(child_explanations)
        explanation.append(f"{indent_str}  Total EMV = {' + '.join(str(c) for c in child_contributions)} = {expected_emv}")
        for edge in node['edges']:
            edge['is_optimal'] = False
        return expected_emv, explanation

# Initial tree setup form
if st.session_state.tree is None:
    st.subheader("Step 1: Define Your Decision Tree")
    with st.form(key='initial_setup_form'):
        root_label = st.text_input("Root Node Label", value="Prototype or Not?", 
                                   help="Enter a name for the initial decision, e.g., 'Prototype or Not?'")
        num_options = st.number_input("Number of Decision Options", min_value=1, max_value=5, value=2, step=1,
                                      help="How many choices stem from this decision? (e.g., 2 for 'Prototype' and 'No Prototype')")
        
        decision_options = []
        for i in range(num_options):
            st.markdown(f"#### Decision Option {i+1}")
            option_name = st.text_input(f"Option {i+1} Name", value="Prototype" if i == 0 else "No Prototype", key=f"option_name_{i}",
                                        help="Name this decision option, e.g., 'Prototype'")
            initial_cost = st.number_input(f"Initial Cost for Option {i+1}", value=100000.0 if i == 0 else 0.0, step=1000.0, key=f"initial_cost_{i}",
                                           help="Cost of this option, e.g., 100000 for $100,000")
            child_type = st.selectbox(f"Child Node Type for Option {i+1}", ["chance", "end"], index=0, key=f"child_type_{i}",
                                      help="Choose 'chance' for uncertain outcomes or 'end' for a final result")
            child_label = st.text_input(f"Child Node Label for Option {i+1}", value="Market Response", key=f"child_label_{i}",
                                        help="Name the resulting node, e.g., 'Market Response'")
            
            if child_type == "chance":
                num_outcomes = st.number_input(f"Number of Outcomes for Option {i+1}", min_value=1, max_value=5, value=2, step=1, 
                                               key=f"num_outcomes_{i}", help="How many possible outcomes? (e.g., 2 for 'Success' and 'Failure')")
                outcomes = []
                for j in range(num_outcomes):
                    st.markdown(f"**Outcome {j+1}**")
                    outcome_name = st.text_input(f"Outcome {j+1} Name", value="Success" if j == 0 else "Failure", key=f"outcome_name_{i}_{j}",
                                                 help="Name this outcome, e.g., 'Success'")
                    probability = st.number_input(f"Probability for Outcome {j+1}", min_value=0.0, max_value=1.0, 
                                                  value=0.7 if i == 0 and j == 0 else 0.3 if i == 0 else 0.2 if j == 0 else 0.8, 
                                                  step=0.01, key=f"probability_{i}_{j}",
                                                  help="Probability (0 to 1), all must sum to 1")
                    payoff = st.number_input(f"Payoff for Outcome {j+1}", value=500000.0 if i == 0 and j == 0 else -50000.0 if i == 0 else 500000.0 if i == 1 and j == 0 else -250000.0, 
                                             step=1000.0, key=f"payoff_{i}_{j}",
                                             help="Final value, e.g., 500000 for $500,000")
                    outcomes.append({'name': outcome_name, 'probability': probability, 'payoff': payoff})
                decision_options.append({
                    'option_name': option_name,
                    'initial_cost': initial_cost,
                    'child_type': child_type,
                    'child_label': child_label,
                    'outcomes': outcomes
                })
            else:
                payoff = st.number_input(f"Payoff for Option {i+1}", value=0.0, step=1000.0, key=f"payoff_end_{i}",
                                         help="Final value for this end node")
                decision_options.append({
                    'option_name': option_name,
                    'initial_cost': initial_cost,
                    'child_type': child_type,
                    'child_label': child_label,
                    'payoff': payoff
                })
        
        submit_initial = st.form_submit_button("Create Tree")
        if submit_initial:
            if not root_label.strip():
                st.error("Please enter a label for the root node.")
            else:
                tree = {'type': 'decision', 'label': root_label, 'edges': []}
                for option in decision_options:
                    if not option['option_name'].strip() or not option['child_label'].strip():
                        st.error("All option and child node names must be filled out.")
                        break
                    if option['child_type'] == 'chance':
                        probabilities = [outcome['probability'] for outcome in option['outcomes']]
                        if not (0.99 < sum(probabilities) < 1.01):
                            st.error(f"Probabilities for '{option['child_label']}' must sum to 1, got {sum(probabilities):.2f}.")
                            break
                        chance_node = {'type': 'chance', 'label': option['child_label'], 'edges': []}
                        for outcome in option['outcomes']:
                            end_node = {'type': 'end', 'label': outcome['name'], 'payoff': outcome['payoff']}
                            chance_node['edges'].append({
                                'label': outcome['name'],
                                'probability': outcome['probability'],
                                'child': end_node
                            })
                        tree['edges'].append({
                            'label': option['option_name'],
                            'initial_cost': option['initial_cost'],
                            'child': chance_node
                        })
                    else:
                        end_node = {'type': 'end', 'label': option['child_label'], 'payoff': option['payoff']}
                        tree['edges'].append({
                            'label': option['option_name'],
                            'initial_cost': option['initial_cost'],
                            'child': end_node
                        })
                else:
                    st.session_state.tree = tree
                    st.success("Tree created successfully!")
                    st.rerun()

else:
    tree = st.session_state.tree
    
    # Display tree visualization
    st.subheader("Your Decision Tree")
    tree_image = generate_tree_image(tree)
    if tree_image:
        st.image(tree_image, caption="Decision Tree (Red lines show optimal path)", use_container_width=True)
    else:
        st.warning("Tree visualization failed")

    # Sidebar for tree management
    with st.sidebar:
        st.subheader("Manage Your Tree")
        
        # Add child node
        node_paths = list(get_node_paths(tree))
        if node_paths:
            st.markdown("### Add Child Node")
            labels = [label for label, _ in node_paths]
            parent_label = st.selectbox("Parent Node", labels, help="Select a parent node to add a child to.")
            parent_node = node_paths[labels.index(parent_label)][1]
            
            if parent_node['type'] != 'end':
                st.write(f"Adding to: **{parent_label}**")
                with st.form(key='add_child_form'):
                    if parent_node['type'] == 'decision':
                        edge_label_prompt = "Decision Option Name"
                        edge_label_help = "E.g., 'Prototype'"
                        initial_cost = st.number_input("Initial Cost", value=0.0, step=1000.0)
                        child_type_options = ["chance", "end"]
                    elif parent_node['type'] == 'chance':
                        edge_label_prompt = "Outcome Name"
                        edge_label_help = "E.g., 'Success'"
                        probability = st.number_input("Probability (0 to 1)", min_value=0.0, max_value=1.0, value=0.5, step=0.01)
                        child_type_options = ["end"]
                    edge_label = st.text_input(edge_label_prompt, help=edge_label_help)
                    child_type = st.selectbox("Child Node Type", child_type_options)
                    child_label = st.text_input("Child Node Name", help="E.g., 'Market Response'")
                    if child_type == "end":
                        payoff = st.number_input("Payoff", value=0.0, step=1000.0)
                    else:
                        payoff = None
                    add_child = st.form_submit_button("Add Child")
                    if add_child:
                        if not edge_label.strip() or not child_label.strip():
                            st.error("Names are required.")
                        elif parent_node['type'] == 'chance' and probability <= 0:
                            st.error("Probability must be greater than 0.")
                        else:
                            new_child = {
                                'type': child_type,
                                'label': child_label,
                                'payoff': payoff if child_type == 'end' else None,
                                'edges': [] if child_type != 'end' else None
                            }
                            new_edge = {'label': edge_label, 'child': new_child}
                            if parent_node['type'] == 'decision':
                                new_edge['initial_cost'] = initial_cost
                            elif parent_node['type'] == 'chance':
                                new_edge['probability'] = probability
                            parent_node['edges'].append(new_edge)
                            st.success(f"Added '{child_label}'")
                            st.rerun()
        
        # Edit node
        st.markdown("### Edit Node")
        if node_paths:
            edit_label = st.selectbox("Select Node to Edit", [label for label, _ in node_paths])
            selected_node = node_paths[[label for label, _ in node_paths].index(edit_label)][1]
            with st.form(key='edit_node_form'):
                new_label = st.text_input("Node Label", value=selected_node['label'])
                if selected_node['type'] == 'end':
                    new_payoff = st.number_input("Payoff", value=selected_node['payoff'], step=1000.0)
                else:
                    new_payoff = None
                if selected_node['type'] != 'end':
                    label_prompt = "Decision Option" if selected_node['type'] == 'decision' else "Outcome"
                    for i, edge in enumerate(selected_node['edges']):
                        edge['label'] = st.text_input(f"{label_prompt} {i+1} Name", value=edge['label'], key=f"edge_label_{id(selected_node)}_{i}")
                        if selected_node['type'] == 'decision':
                            edge['initial_cost'] = st.number_input(f"{label_prompt} {i+1} Initial Cost", value=edge['initial_cost'], step=1000.0, key=f"edge_cost_{id(selected_node)}_{i}")
                        elif selected_node['type'] == 'chance':
                            edge['probability'] = st.number_input(f"{label_prompt} {i+1} Probability", value=edge['probability'], min_value=0.0, max_value=1.0, step=0.01, key=f"edge_prob_{id(selected_node)}_{i}")
                    if selected_node['type'] == 'chance':
                        total_prob = sum(edge['probability'] for edge in selected_node['edges'])
                        st.write(f"Total probability: {total_prob:.2f} (should be 1.00)")
                save_edit = st.form_submit_button("Save Changes")
                if save_edit:
                    selected_node['label'] = new_label
                    if selected_node['type'] == 'end':
                        selected_node['payoff'] = new_payoff
                    st.success("Node updated!")
                    st.rerun()
        
        # Delete node
        st.markdown("### Delete Node")
        non_root_nodes = [(label, node) for label, node in node_paths if node is not tree]
        if non_root_nodes:
            delete_labels = [label for label, _ in non_root_nodes]
            selected_delete_label = st.selectbox("Select Node to Delete", delete_labels)
            selected_delete_node = non_root_nodes[delete_labels.index(selected_delete_label)][1]
            confirm_delete = st.checkbox(f"Confirm deletion of '{selected_delete_label}'")
            if st.button("Delete Node") and confirm_delete:
                if remove_node(tree, selected_delete_node):
                    st.success(f"Deleted '{selected_delete_label}'")
                    st.rerun()
        
        # Compute optimal decision
        if st.button("Compute Optimal Path"):
            try:
                emv, explanation = compute_emv(tree, current_cost=0, indent=0)
                st.session_state.computed = True
                st.session_state.explanation = explanation
                st.success("Optimal path computed!")
                st.rerun()
            except Exception as e:
                st.error(f"Error: {str(e)}")

    # Display optimal decision if computed
    if st.session_state.computed and tree['type'] == 'decision':
        for edge in tree['edges']:
            if edge['is_optimal']:
                st.write(f"**Optimal Decision**: '{edge['label']}' with EMV {tree['value']:.2f}")
                break

    # Display chance node EMVs if computed
    if st.session_state.computed:
        st.subheader("Chance Node EMVs")
        chance_emvs = collect_chance_emvs(tree)
        for label, emv in chance_emvs:
            st.write(f"EMV for Chance Node '{label}': {emv:.2f}")

    # Display net path values if computed
    if st.session_state.computed:
        st.subheader("Net Path Values")
        all_paths = get_all_paths(tree)
        for path, net_value, prob in all_paths:
            path_str = " -> ".join(path)
            st.write(f"Path: {path_str}, Net Value: {net_value:.2f}, Probability: {prob:.2f}")

    # Display EMV calculation details if computed
    if st.session_state.computed:
        with st.expander("EMV Calculation Details"):
            for line in st.session_state.explanation:
                st.write(line)

    # Interpretation guide
    st.markdown("""
    ### Understanding Your Tree:
    - **Box**: Decision nodes (choose the best option).  
    - **Ellipse**: Chance nodes (weighted outcomes).  
    - **Diamond**: End nodes (final payoffs).  
    - **Red Edges**: Optimal path after EMV computation.  
    - **EMV**: Expected Monetary Value, factoring in costs.  
    - **Net Path Value**: Payoff minus total costs to each end node.
    """)
